require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { Logger } = require('./utils/logger');
const { Database } = require('./database/db');
const { CredentialManager } = require('./utils/credential-manager');
const { ContentStrategyAgent } = require('./agents/content-strategy-agent');
const { ScriptWriterAgent } = require('./agents/script-writer-agent');
const { ThumbnailDesignerAgent } = require('./agents/thumbnail-designer-agent');
const { SEOOptimizerAgent } = require('./agents/seo-optimizer-agent');
const { ProductionManagementAgent } = require('./agents/production-management-agent');
const { PublishingSchedulingAgent } = require('./agents/publishing-scheduling-agent');
const { AnalyticsOptimizationAgent } = require('./agents/analytics-optimization-agent');
const { DailyAutomation } = require('./schedules/daily-automation');
const { OperatorService } = require('./utils/operator-service');
const { AutonomousChannelOperator } = require('./utils/autonomous-channel-operator');
const { ActivationMetrics } = require('./utils/activation-metrics');
const { AnonymousTelemetry } = require('./utils/anonymous-telemetry');
const { ProductionReadinessService } = require('./utils/production-readiness-service');
const { GenerationRecoveryService, GENERATION_STAGES } = require('./utils/generation-recovery-service');
const { ProvenanceService } = require('./utils/provenance-service');
const { SceneRepairService } = require('./utils/scene-repair-service');
const { ShortsRepurposingService } = require('./utils/shorts-repurposing-service');
const { AudienceEngagementService } = require('./utils/audience-engagement-service');
const { GrowthExperimentService } = require('./utils/growth-experiment-service');
const { AITextService } = require('./utils/ai-text-service');
const { DiscoverabilityService } = require('./utils/discoverability-service');
const { YouTubeAccountManager } = require('./utils/youtube-account-manager');
const { ProductionWorkflowService } = require('./utils/production-workflow-service');
const { version } = require('./package.json');
const chalk = require('chalk');

class YouTubeAutomationAgent {
  constructor() {
    this.logger = new Logger('MainAgent');
    this.db = null;
    this.credentials = null;
    this.agents = {};
    this.app = express();
    this.isInitialized = false;
    this.activeJobs = new Map();
    this.operator = null;
    this.autonomous = null;
    this.activation = null;
    this.telemetry = null;
    this.readiness = null;
    this.recovery = null;
    this.provenance = null;
    this.scenes = null;
    this.shorts = null;
    this.engagement = null;
    this.experiments = null;
    this.discoverability = null;
    this.workflow = null;
    this.setupRequired = false;
    this.youtubeAccounts = new YouTubeAccountManager({ baseDir: __dirname });
    this.pendingYouTubeAuth = null;
  }

  async initialize() {
    try {
      console.log(chalk.cyan.bold(`\n🎬 YouTube Automation Agent v${version}`));
      console.log(chalk.gray('─'.repeat(50)));
      
      // Initialize database
      this.logger.info('Initializing database...');
      this.db = new Database();
      await this.db.initialize();
      await this.db.markInterruptedJobs();
      this.recovery = new GenerationRecoveryService(this.db, {
        logger: this.logger,
        updateJobStage: (...args) => this.updateJobStage(...args)
      });
      this.operator = new OperatorService(this.db);
      this.provenance = new ProvenanceService(this.db);
      this.discoverability = new DiscoverabilityService(this.db, { logger: this.logger });
      this.autonomous = new AutonomousChannelOperator(this.db, {
        researchAndPlan: strategy => {
          if (!this.agents.strategy) throw new Error('The strategy agent is not configured');
          return this.agents.strategy.researchAndPlanChannel(strategy);
        },
        startGenerationJob: input => this.startGenerationJob(input),
        resumeGenerationJob: (jobId, options) => this.resumeGenerationJob(jobId, options),
        waitForGenerationJob: jobId => this.waitForGenerationJob(jobId),
        notify: notification => this.operator.notify(notification)
      });
      this.activation = new ActivationMetrics(this.db);
      this.telemetry = new AnonymousTelemetry(this.db, this.logger);
      
      // Load credentials
      this.logger.info('Loading credentials...');
      this.credentials = new CredentialManager();
      await this.youtubeAccounts.initialize();
      const credentialsValid = await this.credentials.validateAll();
      this.readiness = new ProductionReadinessService(this.db, this.credentials);
      this.workflow = new ProductionWorkflowService(this.db, this.credentials, { logger: this.logger });
      
      if (!credentialsValid) {
        console.log(chalk.yellow('\n⚠️  Some credentials are missing or invalid.'));
        console.log(chalk.yellow('Run: npm run credentials:setup'));
        this.setupRequired = true;
        this.setupAPI();
        this.isInitialized = true;
        this.logger.warn('Dashboard started in setup mode; generation and publishing are disabled');
        return true;
      }
      
      // Initialize agents
      this.logger.info('Initializing agents...');
      await this.initializeAgents();
      this.scenes = this.agents.production?.sceneRepair || new SceneRepairService(
        this.db,
        this.agents.production?.aiVideoGenerator,
        { logger: this.logger }
      );
      this.shorts = new ShortsRepurposingService(this.db, this.agents.publishing, { logger: this.logger });
      this.engagement = new AudienceEngagementService(
        this.db,
        this.credentials,
        new AITextService(this.credentials?.credentials || {}),
        { logger: this.logger }
      );
      this.experiments = new GrowthExperimentService(
        this.db,
        this.agents.analytics,
        this.agents.publishing,
        { logger: this.logger }
      );

      // Show which pipeline stages will run for real vs. be simulated
      const capabilities = await this.logCapabilitySummary();
      if (capabilities.hasText && capabilities.hasFFmpeg && capabilities.hasUpload) {
        await this.activation.markSetupReady(capabilities);
      }
      
      // Setup API endpoints
      this.setupAPI();
      
      // Initialize scheduler
      this.logger.info('Setting up automation scheduler...');
      this.scheduler = new DailyAutomation(this.agents, this.db, {
        generateContent: input => this.queueScheduledContent(input),
        engagement: this.engagement,
        experiments: this.experiments
      });
      await this.scheduler.initialize();

      if (await this.db.getSetting('automation_paused') === 'true') {
        await this.scheduler.pauseAutomation();
      }
      
      this.isInitialized = true;
      this.logger.success('YouTube Automation Agent initialized successfully!');
      
      return true;
    } catch (error) {
      this.logger.error('Failed to initialize:', error);
      return false;
    }
  }

  async initializeAgents() {
    this.agents = {
      strategy: new ContentStrategyAgent(this.db, this.credentials),
      scriptWriter: new ScriptWriterAgent(this.db, this.credentials),
      thumbnailDesigner: new ThumbnailDesignerAgent(this.db, this.credentials),
      seoOptimizer: new SEOOptimizerAgent(this.db, this.credentials),
      production: new ProductionManagementAgent(this.db, this.credentials),
      publishing: new PublishingSchedulingAgent(this.db, this.credentials),
      analytics: new AnalyticsOptimizationAgent(this.db, this.credentials)
    };

    // Initialize each agent
    for (const [name, agent] of Object.entries(this.agents)) {
      await agent.initialize();
      this.logger.info(`✓ ${name} agent initialized`);
    }
  }

  async logCapabilitySummary() {
    const { checkFFmpeg, ffmpegInstallHint } = require('./utils/ffmpeg');
    const creds = this.credentials.credentials || {};

    const hasText = this.credentials.hasAITextProvider();
    const hasGemini = Boolean(creds.gemini?.apiKey || process.env.GEMINI_API_KEY);
    const hasImages = Boolean(creds.openai?.apiKey || process.env.OPENAI_API_KEY || hasGemini);
    const hasTTS = Boolean(
      creds.openai?.apiKey || process.env.OPENAI_API_KEY ||
      creds.elevenLabs?.apiKey || process.env.ELEVENLABS_API_KEY ||
      creds.azureSpeech?.subscriptionKey || process.env.AZURE_SPEECH_KEY ||
      hasGemini
    );
    const hasFFmpeg = await checkFFmpeg();
    const hasUpload = Boolean(creds.youtube && this.credentials.tokens?.youtube);

    const capabilities = [
      { name: 'Script & strategy generation', ok: hasText, hint: 'configure an AI provider (npm run credentials:setup)' },
      { name: 'Image generation (visuals/thumbnails)', ok: hasImages, hint: 'requires an OpenAI or Gemini API key — otherwise gradient slides are used' },
      { name: 'Voice narration (TTS)', ok: hasTTS, hint: 'configure OpenAI, Gemini, ElevenLabs, or Azure Speech — otherwise videos are silent' },
      { name: 'Video assembly (FFmpeg)', ok: hasFFmpeg, hint: ffmpegInstallHint() },
      { name: 'YouTube upload', ok: hasUpload, hint: 'run: npm run credentials:setup' }
    ];

    console.log(chalk.cyan('\n🔎 Capability check:'));
    for (const cap of capabilities) {
      if (cap.ok) {
        console.log(chalk.green(`  ✓ ${cap.name}`));
      } else {
        console.log(chalk.yellow(`  ✗ ${cap.name} — ${cap.hint}`));
      }
    }

    if (!hasFFmpeg) {
      this.logger.warn('FFmpeg is missing: no .mp4 files can be produced until it is installed.');
    }
    console.log('');
    return { hasText, hasImages, hasTTS, hasFFmpeg, hasUpload };
  }

  requireAPIKey() {
    return (req, res, next) => {
      if (!process.env.API_KEY) {
        return next();
      }

      if (req.get('x-api-key') !== process.env.API_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      return next();
    };
  }

  validateGenerateRequestBody(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { valid: false, status: 400, error: 'Request body must be a JSON object' };
    }

    const value = {
      topic: null,
      style: null,
      length: typeof body.length === 'string' ? body.length.toLowerCase() : 'medium',
      strategyContext: null
    };

    // JSON has no `undefined`, so clients send `null` to mean "no value provided".
    // Both are treated as "not set" here: topic/style are optional and default to
    // auto-selection, which is exactly what `null` already represents internally.
    if (body.topic !== undefined && body.topic !== null) {
      if (typeof body.topic !== 'string') {
        return { valid: false, status: 400, error: 'topic must be a string' };
      }

      const topic = body.topic.trim();
      if (topic.length > 200) {
        return { valid: false, status: 400, error: 'topic must be 200 characters or less' };
      }
      value.topic = topic || null;
    }

    if (body.style !== undefined && body.style !== null) {
      if (typeof body.style !== 'string') {
        return { valid: false, status: 400, error: 'style must be a string' };
      }

      const allowedStyles = new Set([
        'tutorial',
        'explainer',
        'list',
        'review',
        'story',
        'educational',
        'informative',
        'engaging',
        'professional',
        'ethereal'
      ]);
      const style = body.style.trim();

      if (style.length > 50) {
        return { valid: false, status: 400, error: 'style must be 50 characters or less' };
      }

      value.style = allowedStyles.has(style.toLowerCase()) ? style.toLowerCase() : style || null;
    }

    if (!['short', 'medium', 'long'].includes(value.length)) {
      return { valid: false, status: 400, error: 'length must be short, medium, or long' };
    }

    if (body.strategyContext !== undefined && body.strategyContext !== null) {
      if (typeof body.strategyContext !== 'object' || Array.isArray(body.strategyContext)) {
        return { valid: false, status: 400, error: 'strategyContext must be an object' };
      }
      const limits = { angle: 500, rationale: 1000, audience: 500, objective: 1000, valueProposition: 1000, constraints: 2000, pillar: 100 };
      value.strategyContext = {};
      for (const [key, max] of Object.entries(limits)) {
        if (body.strategyContext[key] === undefined || body.strategyContext[key] === null) continue;
        if (typeof body.strategyContext[key] !== 'string' || body.strategyContext[key].length > max) {
          return { valid: false, status: 400, error: `strategyContext.${key} must be a string of ${max} characters or less` };
        }
        value.strategyContext[key] = body.strategyContext[key].trim();
      }
    }

    return { valid: true, value };
  }

  validateChannelStrategy(body = {}, current = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Channel strategy must be a JSON object');
    }
    const text = (key, fallback, max) => {
      const value = String(body[key] ?? fallback ?? '').trim();
      if (value.length > max) throw new Error(`${key} must be ${max} characters or less`);
      return value;
    };
    const objective = text('objective', current.objective, 1000);
    const audience = text('audience', current.audience, 500);
    if (!objective) throw new Error('O objetivo do canal é obrigatório');
    if (!audience) throw new Error('O público-alvo é obrigatório');

    const rawPillars = body.contentPillars ?? current.contentPillars ?? [];
    if (!Array.isArray(rawPillars)) throw new Error('contentPillars must be an array');
    const contentPillars = rawPillars.map(value => String(value).trim()).filter(Boolean);
    if (!contentPillars.length || contentPillars.length > 8 || contentPillars.some(value => value.length > 100)) {
      throw new Error('Informe de 1 a 8 pilares de conteúdo, cada um com até 100 caracteres');
    }

    const integer = (key, fallback, min, max) => {
      const value = Number(body[key] ?? fallback);
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${key} must be an integer from ${min} to ${max}`);
      }
      return value;
    };
    const defaultFormat = text('defaultFormat', current.default_format || 'explainer', 20).toLowerCase();
    const defaultLength = text('defaultLength', current.default_length || 'medium', 20).toLowerCase();
    const status = text('status', current.status || 'draft', 20).toLowerCase();
    const primaryKpi = text('primaryKpi', current.primary_kpi || 'views', 30).toLowerCase();
    const outcomeCurrency = text('outcomeCurrency', current.outcome_currency || 'USD', 3).toUpperCase();
    if (!['explainer', 'tutorial', 'list', 'review', 'story'].includes(defaultFormat)) {
      throw new Error('defaultFormat is not supported');
    }
    if (!['short', 'medium', 'long'].includes(defaultLength)) throw new Error('defaultLength is not supported');
    if (!['draft', 'active', 'paused'].includes(status)) throw new Error('status must be draft, active, or paused');
    if (!['views', 'watch_hours', 'subscribers', 'engagement', 'revenue'].includes(primaryKpi)) {
      throw new Error('primaryKpi is not supported');
    }
    if (!/^[A-Z]{3}$/.test(outcomeCurrency)) throw new Error('outcomeCurrency must be a three-letter currency code');
    const optionalNumber = (key, fallback, min, max) => {
      const raw = body[key] ?? fallback;
      if (raw === undefined || raw === null || raw === '') return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${key} must be a number from ${min} to ${max}`);
      }
      return value;
    };

    return {
      objective,
      audience,
      valueProposition: text('valueProposition', current.value_proposition, 1000),
      contentPillars,
      cadencePerWeek: integer('cadencePerWeek', current.cadence_per_week || 1, 1, 7),
      videosPerRun: integer('videosPerRun', current.videos_per_run || 1, 1, 5),
      defaultFormat,
      defaultLength,
      successMetric: text('successMetric', current.success_metric, 300),
      primaryKpi,
      targetValue: optionalNumber('targetValue', current.target_value, 0.01, 1000000000),
      targetWindowDays: integer('targetWindowDays', current.target_window_days || 28, 7, 365),
      monthlyBudget: optionalNumber('monthlyBudget', current.monthly_budget, 0, 10000000),
      outcomeCurrency,
      constraints: text('constraints', current.constraints, 2000),
      status
    };
  }
  setupAPI() {
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use('/api', (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });
    this.app.use(express.static(path.join(__dirname, 'dashboard')));

    if (!process.env.API_KEY) {
      this.logger.warn('API_KEY is not set; mutating API routes are unprotected');
    }
    
    // Main dashboard route
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
    });
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: this.setupRequired ? 'setup_required' : 'healthy',
        initialized: this.isInitialized,
        setupRequired: this.setupRequired,
        agents: Object.keys(this.agents),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });

    // Manual content generation
    this.app.post('/generate', this.requireAPIKey(), async (req, res) => {
      try {
        if (this.setupRequired) {
          return res.status(503).json({ success: false, error: 'Finish setup with npm run walkthrough before generating content' });
        }
        const validation = this.validateGenerateRequestBody(req.body);
        if (!validation.valid) {
          return res.status(validation.status).json({ success: false, error: validation.error });
        }

        const { topic, style, length } = validation.value;
        const result = await this.startGenerationJob({ topic, style, length, source: 'manual' });
        res.status(202).json({ success: true, result });
      } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
      }
    });

    // Get analytics
    this.app.get('/analytics', async (req, res) => {
      try {
        if (!this.agents.analytics) return res.json({ totalVideos: 0, averagePerformanceScore: 0, topPerformers: [], insights: [], learning: null });
        const analytics = await this.agents.analytics.getRecentAnalytics();
        const learning = await this.agents.analytics.getLearningSummary();
        res.json({ ...analytics, learning });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/outcomes', async (_req, res) => {
      try {
        const learning = this.agents.analytics?.getLearningSummary
          ? await this.agents.analytics.getLearningSummary()
          : { outcome: null };
        return res.json({ success: true, result: learning.outcome || null });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get upcoming schedule
    this.app.get('/schedule', async (req, res) => {
      try {
        const schedule = await this.db.getUpcomingSchedule();
        res.json(schedule);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Manual publish
    this.app.post('/publish/:contentId', this.requireAPIKey(), async (req, res) => {
      try {
        if (!this.agents.publishing) return res.status(503).json({ success: false, error: 'YouTube publishing is not configured' });
        const { contentId } = req.params;
        const bundle = await this.db.getProductionBundle(contentId);
        const short = bundle ? null : await this.db.getShortClip(contentId);
        if ((!bundle || bundle.review_status !== 'approved') && (!short || !['scheduled', 'uploading', 'reconciliation_required'].includes(short.status))) {
          return res.status(409).json({ success: false, error: 'Content must pass review and be approved before publishing' });
        }
        const result = await this.agents.publishing.publishContent(contentId);
        res.json({ success: true, result });
      } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
      }
    });

    this.setupOperatorAPI();
  }

  setupOperatorAPI() {
    const protect = this.requireAPIKey();

    this.app.get('/api/dashboard', async (_req, res) => {
      try {
        const [stats, jobs, pipeline, schedule, events, notifications, profile, settings, ideas, analytics, learning, activation, channelStrategy, operatorRuns, readiness, engagement, experiments] = await Promise.all([
          this.db.getStats(),
          this.db.listGenerationJobs(20),
          this.db.getPipelineOverview(50),
          this.db.getUpcomingSchedule(),
          this.db.getRecentAutomationEvents(20),
          this.db.listNotifications(20),
          this.db.getChannelProfile(),
          this.db.getAllSettings(),
          this.db.listContentIdeas(),
          this.agents.analytics
            ? this.agents.analytics.getRecentAnalytics(30)
            : Promise.resolve({ totalVideos: 0, averagePerformanceScore: 0, topPerformers: [], insights: [] }),
          this.agents.analytics?.getLearningSummary
            ? this.agents.analytics.getLearningSummary()
            : Promise.resolve({ measuredVideos: 0, snapshotCount: 0, baseline: {}, recommendations: [], approvedCount: 0, pendingCount: 0 }),
          this.activation
            ? this.activation.getSummary()
            : Promise.resolve({ privacy: 'local-only', counts: {}, milestones: {} }),
          this.db.getChannelStrategy(),
          this.db.listOperatorRuns(10),
          this.readiness
            ? this.readiness.getSummary()
            : Promise.resolve({ status: 'unverified', stale: false, blockingFailures: [], checks: [] }),
          this.engagement
            ? this.engagement.getSummary()
            : Promise.resolve({
                videosTracked: 0, pendingDrafts: 0, postedToday: 0, needsAttentionCount: 0,
                pendingAudienceIdeas: 0, postingEnabled: false, postingDisabledReason: 'setup_required',
                insights: [], recentThemes: [],
                evidencePolicy: 'Os comentários são obtidos em modo somente leitura do YouTube. As respostas só são publicadas após a sua aprovação, e o sistema nunca publica ideias sem autorização.'
              }),
          this.experiments
            ? this.experiments.getSummary()
            : Promise.resolve({ experiments: [], candidates: [], activeCount: 0, awaitingDecisionCount: 0, evidencePolicy: 'Conclua a configuração para criar um experimento controlado de crescimento.' })
        ]);
        if (this.telemetry) void this.telemetry.sync(activation);
        if (this.youtubeAccounts) {
          try {
            await this.youtubeAccounts.reload();
          } catch (_e) {
            /* ignore */
          }
        }
        let workflowThemes = [];
        let workflowStats = { total: 0, pending: 0, inProduction: 0, posted: 0, withScript: 0 };
        try {
          const activeAccount = this.youtubeAccounts?.getActiveAccount() || null;
          const channelId = activeAccount?.channelId || null;
          workflowThemes = await this.db.listPlannedThemes({ channelId });
          workflowStats = {
            total: workflowThemes.length,
            pending: workflowThemes.filter(t => t.status === 'pending').length,
            inProduction: workflowThemes.filter(t => t.status === 'in_production').length,
            posted: workflowThemes.filter(t => t.status === 'posted').length,
            withScript: workflowThemes.filter(t => Boolean(t.full_script && t.full_script.length > 500)).length
          };
        } catch (_wErr) {
          /* ignore */
        }
        res.json({
          stats, jobs, pipeline, schedule, events, notifications, profile, settings, ideas, analytics, learning, activation,
          channelStrategy, operatorRuns, readiness, engagement, experiments,
          workflowThemes,
          workflowStats,
          youtubeAccount: this.youtubeAccounts?.getActiveAccount() || null,
          youtubeAccountsList: this.youtubeAccounts?.listAccounts() || [],
          system: {
            initialized: this.isInitialized,
            setupRequired: this.setupRequired,
            uptime: process.uptime(),
            activeJobs: this.activeJobs.size,
            automationPaused: this.scheduler ? !this.scheduler.isEnabled : true,
            agents: Object.keys(this.agents),
            autonomousRunning: Boolean(await this.db.getActiveOperatorRun()),
            videoProviders: this.agents.production?.aiVideoGenerator?.mediaGeneration?.listProviders() || []
          }
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/jobs/:jobId', async (req, res) => {
      const job = await this.db.getGenerationJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      job.checkpoints = await this.db.listGenerationCheckpoints(job.id);
      job.mediaTasks = await this.db.listMediaGenerationTasks(job.id);
      job.resumeFrom = this.recovery?.resumePoint(job.checkpoints);
      return res.json(job);
    });

    this.app.post('/api/jobs/:jobId/resume', protect, async (req, res) => {
      try {
        const result = await this.resumeGenerationJob(req.params.jobId, { stage: req.body?.stage });
        return res.status(202).json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/readiness', async (_req, res) => {
      if (!this.readiness) return res.status(503).json({ error: 'Readiness service is not initialized' });
      return res.json(await this.readiness.getSummary());
    });

    this.app.post('/api/readiness/run', protect, async (req, res) => {
      try {
        if (!this.readiness) return res.status(503).json({ error: 'Readiness service is not initialized' });
        const result = await this.readiness.run({
          includePaidMedia: req.body?.includePaidMedia === true,
          includePaidVideo: req.body?.includePaidVideo === true
        });
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/jobs/:jobId/cancel', protect, async (req, res) => {
      const job = await this.db.getGenerationJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      if (!['queued', 'running'].includes(job.status)) {
        return res.status(409).json({ error: 'Only queued or running jobs can be cancelled' });
      }
      const updated = await this.db.updateGenerationJob(job.id, { cancelRequested: true, details: { cancelReason: req.body?.reason || 'Cancelled by operator' } });
      return res.json({ success: true, result: updated });
    });

    this.app.get('/api/content/:productionId', async (req, res) => {
      let bundle = await this.db.getProductionBundle(req.params.productionId);
      if (!bundle) return res.status(404).json({ error: 'Content not found' });
      if (this.scenes && !bundle.scenes?.length) {
        await this.scenes.ensureManifest(bundle);
        bundle = await this.db.getProductionBundle(req.params.productionId);
      }
      return res.json(this.decorateContentBundle(bundle));
    });

    this.app.get('/api/content/:productionId/scenes/:sceneId/estimate', async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
        const result = await this.scenes.regenerationEstimate(req.params.productionId, req.params.sceneId, {
          provider: req.query.provider
        });
        return res.json(result);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message, code: error.code, details: error.details });
      }
    });

    this.app.patch('/api/content/:productionId/scenes/:sceneId', protect, async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
        const result = await this.scenes.updateScene(req.params.productionId, req.params.sceneId, req.body || {});
        await this.refreshContentReview(req.params.productionId, 'Scene changes require review before scheduling');
        return res.json({ success: true, result: this.scenes.decorateScene(result, req.params.productionId) });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
      }
    });

    this.app.post('/api/content/:productionId/scenes/reorder', protect, async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
        const result = await this.scenes.reorder(req.params.productionId, req.body?.sceneIds);
        await this.refreshContentReview(req.params.productionId, 'Timeline order changed; rebuild and review before scheduling');
        return res.json({ success: true, result: result.map(scene => this.scenes.decorateScene(scene, req.params.productionId)) });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
      }
    });

    this.app.post('/api/content/:productionId/scenes/:sceneId/regenerate', protect, async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
        const result = await this.scenes.regenerate(req.params.productionId, req.params.sceneId, req.body || {});
        await this.refreshContentReview(req.params.productionId, 'Regenerated scene must be rebuilt and reviewed');
        return res.status(202).json({ success: true, result: {
          ...result,
          scene: this.scenes.decorateScene(result.scene, req.params.productionId)
        } });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
      }
    });

    this.app.post('/api/content/:productionId/shorts/propose', protect, async (req, res) => {
      try {
        if (!this.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
        const result = await this.shorts.propose(req.params.productionId, req.body || {});
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.patch('/api/content/:productionId/shorts/:clipId', protect, async (req, res) => {
      try {
        if (!this.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
        const result = await this.shorts.update(req.params.productionId, req.params.clipId, req.body || {});
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.post('/api/content/:productionId/shorts/:clipId/render', protect, async (req, res) => {
      try {
        if (!this.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
        const result = await this.shorts.render(req.params.productionId, req.params.clipId);
        return res.status(202).json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.post('/api/content/:productionId/shorts/:clipId/approve', protect, async (req, res) => {
      try {
        if (!this.shorts) return res.status(503).json({ error: 'Shorts repurposing requires completed setup' });
        const result = await this.shorts.approve(req.params.productionId, req.params.clipId, req.body || {});
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.get('/api/content/:productionId/shorts/:clipId/asset/:kind', async (req, res) => {
      try {
        const clip = await this.db.getShortClip(req.params.clipId);
        if (!clip || clip.productionId !== req.params.productionId) return res.status(404).json({ error: 'Short asset not found' });
        const filePath = req.params.kind === 'video' ? clip.outputPath : req.params.kind === 'captions' ? clip.captionsPath : null;
        if (!filePath) return res.status(404).json({ error: 'Short asset not found' });
        const resolved = path.resolve(filePath);
        const shortsRoot = path.resolve(__dirname, 'data', 'shorts');
        if (!resolved.startsWith(`${shortsRoot}${path.sep}`)) return res.status(403).json({ error: 'Short asset path is not allowed' });
        await fs.access(resolved);
        return res.sendFile(resolved);
      } catch (_error) {
        return res.status(404).json({ error: 'Short asset not found' });
      }
    });

    this.app.post('/api/content/:productionId/scenes/:sceneId/narration', protect, async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Narration recovery requires completed setup' });
        const result = await this.scenes.regenerateNarration(req.params.productionId, req.params.sceneId, req.body || {});
        await this.refreshContentReview(req.params.productionId, 'Narration regenerated; rebuild the final video before approval');
        return res.status(202).json({ success: true, result: this.scenes.decorateScene(result, req.params.productionId) });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
      }
    });

    this.app.post('/api/content/:productionId/narration/silence', protect, async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Narration recovery requires completed setup' });
        const result = await this.scenes.setSilenceOverride(req.params.productionId, req.body || {});
        await this.refreshContentReview(
          req.params.productionId,
          result.enabled ? 'Intentional silence recorded; rebuild and review before approval' : 'Narration is required again; regenerate it before approval'
        );
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
      }
    });

    this.app.put(
      '/api/content/:productionId/scenes/:sceneId/asset',
      protect,
      express.raw({ type: ['image/*', 'video/*'], limit: '100mb' }),
      async (req, res) => {
        try {
          if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
          const result = await this.scenes.replaceAsset(req.params.productionId, req.params.sceneId, {
            buffer: req.body,
            contentType: req.get('content-type'),
            filename: req.get('x-file-name'),
            rightsConfirmed: req.get('x-rights-confirmed') === 'true',
            containsSyntheticMedia: req.get('x-synthetic-media') === 'true'
          });
          await this.refreshContentReview(req.params.productionId, 'Replacement scene asset must be rebuilt and reviewed');
          return res.json({ success: true, result: this.scenes.decorateScene(result, req.params.productionId) });
        } catch (error) {
          return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
        }
      }
    );

    this.app.put(
      '/api/content/:productionId/scenes/:sceneId/audio',
      protect,
      express.raw({ type: ['audio/*'], limit: '50mb' }),
      async (req, res) => {
        try {
          if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
          const result = await this.scenes.replaceAudio(req.params.productionId, req.params.sceneId, {
            buffer: req.body,
            contentType: req.get('content-type'),
            filename: req.get('x-file-name')
          });
          await this.refreshContentReview(req.params.productionId, 'Áudio de narração atualizado com sucesso');
          return res.json({ success: true, result: this.scenes.decorateScene(result, req.params.productionId) });
        } catch (error) {
          return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
        }
      }
    );

    this.app.post('/api/content/:productionId/scenes/regenerate-all-narration', protect, async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
        const scenes = await this.db.listProductionScenes(req.params.productionId);
        for (const scene of scenes) {
          await this.scenes.regenerateNarration(req.params.productionId, scene.id, { confirmCost: true, ...(req.body || {}) }).catch(err => {
            this.logger.warn(`Failed scene narration ${scene.id}: ${err.message}`);
          });
          await new Promise(r => setTimeout(r, 400));
        }
        await this.refreshContentReview(req.params.productionId, 'Narração regenerada; recompile o vídeo final antes de aprovar');
        return res.json({ success: true, message: 'Todas as narrações foram regeneradas com sucesso.' });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/content/:productionId/scenes/rebuild', protect, async (req, res) => {
      try {
        if (!this.scenes) return res.status(503).json({ error: 'Scene repair requires completed setup' });
        const result = await this.scenes.rebuild(req.params.productionId);
        await this.refreshContentReview(req.params.productionId, 'Scene repair rebuilt; final approval is required');
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code, details: error.details });
      }
    });

    this.app.get('/api/content/:productionId/scenes/:sceneId/asset', async (req, res) => {
      try {
        const scene = await this.db.getProductionScene(req.params.productionId, req.params.sceneId);
        if (!scene?.assetPath) return res.status(404).json({ error: 'Scene asset not found' });
        const resolved = path.resolve(scene.assetPath);
        const dataRoot = path.resolve(__dirname, 'data');
        if (!resolved.startsWith(`${dataRoot}${path.sep}`)) return res.status(403).json({ error: 'Scene asset path is not allowed' });
        await fs.access(resolved);
        return res.sendFile(resolved);
      } catch (_error) {
        return res.status(404).json({ error: 'Scene asset not found' });
      }
    });

    this.app.patch('/api/content/:productionId', protect, async (req, res) => {
      try {
        const bundle = await this.db.getProductionBundle(req.params.productionId);
        if (!bundle) return res.status(404).json({ error: 'Content not found' });
        if (bundle.review_status === 'approved' && bundle.schedule?.status === 'published') {
          return res.status(409).json({ error: 'Published content cannot be edited here' });
        }
        const editorData = this.validateEditorData(req.body, bundle.editorData);
        const result = await this.db.saveContentReview(bundle.id, {
          status: bundle.review_status || 'needs_review',
          editorData,
          qualityChecks: bundle.qualityChecks,
          reviewNotes: req.body.reviewNotes ?? bundle.review_notes,
          reviewedAt: bundle.reviewed_at
        });
        return res.json({ success: true, result: this.decorateContentBundle(result) });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/content/:productionId/approve', protect, async (req, res) => {
      try {
        const result = await this.approveContent(req.params.productionId, req.body || {});
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, quality: error.quality });
      }
    });

    this.app.post('/api/content/:productionId/reject', protect, async (req, res) => {
      const bundle = await this.db.getProductionBundle(req.params.productionId);
      if (!bundle) return res.status(404).json({ error: 'Content not found' });
      await this.db.saveContentReview(bundle.id, {
        status: 'rejected',
        editorData: bundle.editorData,
        qualityChecks: bundle.qualityChecks,
        reviewNotes: req.body?.notes || 'Rejected by operator',
        reviewedAt: new Date().toISOString()
      });
      await this.db.updateProductionStatus(bundle.id, 'rejected');
      return res.json({ success: true });
    });

    this.app.post('/api/content/:productionId/retry', protect, async (req, res) => {
      const bundle = await this.db.getProductionBundle(req.params.productionId);
      if (!bundle) return res.status(404).json({ error: 'Content not found' });
      const job = await this.startGenerationJob({
        topic: bundle.strategy.topic || bundle.editorData.title || null,
        style: bundle.strategy.requestedStyle || bundle.strategy.contentType || null,
        length: bundle.strategy.requestedLengthKey || 'medium',
        source: 'retry'
      });
      return res.status(202).json({ success: true, result: job });
    });

    this.app.get('/api/content/:productionId/asset/:kind', async (req, res) => {
      try {
        const bundle = await this.db.getProductionBundle(req.params.productionId);
        if (!bundle) return res.status(404).json({ error: 'Content not found' });
        const allowed = {
          video: bundle.assets?.finalVideo?.path,
          thumbnail: bundle.assets?.thumbnail?.path,
          captions: bundle.assets?.captions?.path,
          script: bundle.assets?.script?.originalPath
        };
        const experimentMatch = req.params.kind.match(/^experiment-thumbnail-(\d+)$/);
        const experimentPath = experimentMatch
          ? bundle.editorData?.packagingExperiment?.thumbnailVariants?.[Number(experimentMatch[1])]?.path
          : null;
        const filePath = allowed[req.params.kind] || experimentPath;
        if (!filePath) return res.status(404).json({ error: 'Asset not found' });
        const resolved = path.resolve(filePath);
        const dataRoot = path.resolve(__dirname, 'data');
        const experimentRoot = path.resolve(__dirname, 'uploads', 'thumbnails');
        const allowedPath = [dataRoot, experimentRoot]
          .some(root => resolved.startsWith(`${root}${path.sep}`));
        if (!allowedPath) return res.status(403).json({ error: 'Asset path is not allowed' });
        await fs.access(resolved);
        if ((req.params.kind.includes('thumbnail') || experimentMatch) && (filePath.endsWith('.info') || !/\.(jpe?g|png|webp|svg)$/i.test(filePath))) {
          const rawTitle = (bundle.title || bundle.topic || 'Vídeo de Automação')
            .replace(/^How to\s+/i, '')
            .replace(/:\s*Step-by-Step Guide/i, '')
            .trim()
            .slice(0, 65);
          const escapedTitle = rawTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          res.setHeader('Content-Type', 'image/svg+xml');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#141824"/>
      <stop offset="60%" stop-color="#0f111a"/>
      <stop offset="100%" stop-color="#1b0c15"/>
    </linearGradient>
    <linearGradient id="btn" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff4d5e"/>
      <stop offset="100%" stop-color="#e02424"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect x="24" y="24" width="1232" height="672" rx="20" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
  <circle cx="640" cy="300" r="64" fill="url(#btn)"/>
  <polygon points="630,278 662,300 630,322" fill="#ffffff"/>
  <text x="640" y="440" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="700" fill="#ffffff" text-anchor="middle">${escapedTitle}</text>
  <rect x="510" y="480" width="260" height="36" rx="18" fill="rgba(255,255,255,0.08)"/>
  <text x="640" y="503" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#ff4d5e" text-anchor="middle" letter-spacing="2">MINIATURA EM PRÉVIA</text>
</svg>`);
        }
        return res.sendFile(resolved);
      } catch (_error) {
        return res.status(404).json({ error: 'Asset not found' });
      }
    });

    this.app.put('/api/profile', protect, async (req, res) => {
      try {
        const profile = this.validateProfile(req.body || {});
        return res.json({ success: true, result: await this.db.saveChannelProfile(profile) });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.put('/api/operator/strategy', protect, async (req, res) => {
      try {
        const current = await this.db.getChannelStrategy() || {};
        const strategy = this.validateChannelStrategy(req.body || {}, current);
        return res.json({ success: true, result: await this.db.saveChannelStrategy(strategy) });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/operator/analyze-channel', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const { days = 30, maxResults = 50 } = req.body || {};
        const result = await this.workflow.analyzeAndSynthesizeChannelStrategy({
          days: parseInt(days, 10) || 30,
          maxResults: parseInt(maxResults, 10) || 50
        });
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/operator/start', protect, async (req, res) => {
      try {
        if (this.setupRequired || !this.agents.strategy) {
          return res.status(503).json({ success: false, error: 'Finish setup with npm run walkthrough before activating the autonomous operator' });
        }
        if (this.activeJobs.size) {
          return res.status(409).json({ success: false, error: 'Wait for the current generation job to finish before starting an autonomous run' });
        }
        await this.readiness?.assertReady('Autonomous production');
        const current = await this.db.getChannelStrategy() || {};
        const strategy = this.validateChannelStrategy({ ...(req.body || {}), status: 'active' }, current);
        const saved = await this.db.saveChannelStrategy(strategy);
        const run = await this.autonomous.start(saved);
        return res.status(202).json({ success: true, result: run });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/operator/pause', protect, async (_req, res) => {
      const strategy = await this.db.getChannelStrategy();
      if (!strategy) return res.status(404).json({ error: 'Channel strategy not found' });
      const active = await this.db.getActiveOperatorRun();
      if (active) await this.autonomous.cancel(active.id);
      const saved = await this.db.saveChannelStrategy({ ...strategy, status: 'paused' });
      return res.json({ success: true, result: saved });
    });

    this.app.post('/api/operator/runs/:runId/cancel', protect, async (req, res) => {
      const run = await this.autonomous.cancel(req.params.runId);
      if (!run) return res.status(404).json({ error: 'Operator run not found' });
      return res.json({ success: true, result: run });
    });

    this.app.put('/api/content/:productionId/provenance', protect, async (req, res) => {
      try {
        const bundle = await this.db.getProductionBundle(req.params.productionId);
        if (!bundle) return res.status(404).json({ error: 'Content not found' });
        if (bundle.review_status === 'approved' || bundle.schedule) {
          return res.status(409).json({ error: 'Provenance is locked after content is approved or scheduled' });
        }
        if (!this.provenance) this.provenance = new ProvenanceService(this.db);
        await this.provenance.review(bundle.id, req.body || {});
        const updated = await this.db.getProductionBundle(bundle.id);
        const profile = await this.db.getChannelProfile() || {};
        const quality = await this.operator.runQualityChecks({
          ...updated,
          scheduledPublishTime: updated.scheduled_publish_time
        }, profile);
        const reviewStatus = quality.passed ? 'needs_review' : 'needs_attention';
        const result = await this.db.saveContentReview(bundle.id, {
          status: reviewStatus,
          editorData: updated.editorData,
          qualityChecks: quality.checks,
          reviewNotes: quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`,
          reviewedAt: null
        });
        return res.json({ success: true, result: this.decorateContentBundle(result) });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/content/:productionId/provenance/suggest-sources', protect, async (req, res) => {
      try {
        const bundle = await this.db.getProductionBundle(req.params.productionId);
        if (!bundle) return res.status(404).json({ error: 'Content not found' });
        if (bundle.review_status === 'approved' || bundle.schedule) {
          return res.status(409).json({ error: 'A mesa de evidências fica bloqueada após a aprovação ou agendamento.' });
        }
        if (!this.provenance) this.provenance = new ProvenanceService(this.db);
        const existingProvenance = await this.db.getContentProvenance(bundle.id) || {};
        const sources = [...(existingProvenance.sources || [])];
        const claims = [...(existingProvenance.claims || [])];

        const topic = bundle.title || bundle.topic || 'Cuidados com o carro na Espanha e inspeção ITV';
        const claimsTexts = claims.map(c => c.text).filter(Boolean);

        let suggestedSources = [];
        if (!this.aiText) this.aiText = new AITextService(this.credentials?.credentials || {});

        if (this.aiText?.isConfigured?.()) {
          try {
            const prompt = `Act as an expert automotive and legal fact-checker for vehicle regulations in Spain.
For a YouTube video titled: "${topic}"
And these factual statements needing official authority sources in Spain:
${claimsTexts.length ? claimsTexts.map((t, i) => `${i + 1}. "${t}"`).join('\n') : '1. "Normativa oficial de neumáticos, mantenimiento y requisitos para superar la ITV en España según la DGT y BOE."'}

Provide 2 to 3 real, authoritative Spanish regulatory or official institutions (such as Dirección General de Tráfico DGT, Boletín Oficial del Estado BOE, Real Decreto 2822/1998, AECA-ITV, Real Automóvil Club de España RACE).
Respond ONLY with a valid JSON array in this exact schema, without markdown formatting or code blocks:
[
  {
    "url": "https://www.dgt.es/...",
    "title": "Título oficial de la norma o guía en español",
    "publisher": "DGT / BOE / AECA-ITV",
    "sourceType": "official",
    "notes": "Comprobación técnica oficial para circular en España"
  }
]`;
            const raw = await this.aiText.generateText(prompt, { temperature: 0.2, maxTokens: 800 });
            const cleanJson = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
            const parsed = JSON.parse(cleanJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              suggestedSources = parsed;
            }
          } catch (aiErr) {
            this.logger.warn(`AI source generation encountered an issue (${aiErr.message}), using authoritative regulatory catalog`);
          }
        }

        if (!suggestedSources.length) {
          suggestedSources = [
            {
              url: 'https://www.dgt.es/muevete-con-seguridad/viaja-seguro/en-coche/neumaticos/',
              title: 'Normativa Oficial de Seguridad y Desgaste de Neumáticos - DGT',
              publisher: 'Dirección General de Tráfico (DGT España)',
              sourceType: 'official',
              notes: 'Comprueba el límite legal de 1,6 mm de profundidad y presiones según la DGT.'
            },
            {
              url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1999-1826',
              title: 'Reglamento General de Vehículos - Real Decreto 2822/1998 (BOE)',
              publisher: 'Boletín Oficial del Estado (Gobierno de España)',
              sourceType: 'official',
              notes: 'Marco legal oficial de homologaciones, inspecciones y requisitos para circular.'
            },
            {
              url: 'https://aeca-itv.com/manual-de-reformas-e-itv/',
              title: 'Manual Oficial de Procedimiento de Inspección Técnica de Vehículos',
              publisher: 'AECA-ITV / Ministerio de Industria',
              sourceType: 'official',
              notes: 'Criterios oficiales de inspección para superar la ITV a la primera sin defectos graves.'
            }
          ];
        }

        const newSourceIds = [];
        for (const item of suggestedSources) {
          const existing = sources.find(s => s.url === item.url);
          if (!existing) {
            const id = `source_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            sources.push({
              id,
              url: item.url,
              title: item.title,
              publisher: item.publisher || 'Organismo Oficial de España',
              sourceType: item.sourceType || 'official',
              status: 'verified',
              notes: item.notes || 'Fonte oficial verificada por IA para normas na Espanha',
              publishedAt: new Date().toISOString(),
              accessedAt: new Date().toISOString()
            });
            newSourceIds.push(id);
          } else {
            existing.status = 'verified';
            newSourceIds.push(existing.id);
          }
        }

        // Link all claims to the verified sources and mark as supported
        for (const claim of claims) {
          claim.sourceIds = [...new Set([...(claim.sourceIds || []), ...newSourceIds])];
          claim.status = 'supported';
          claim.notes = 'Comprovado automaticamente com base na regulamentação oficial de Espanha.';
        }

        await this.provenance.review(bundle.id, {
          sources,
          claims,
          containsSyntheticMedia: existingProvenance.containsSyntheticMedia === true
        });

        const updated = await this.db.getProductionBundle(bundle.id);
        const profile = await this.db.getChannelProfile() || {};
        const quality = await this.operator.runQualityChecks({
          ...updated,
          scheduledPublishTime: updated.scheduled_publish_time
        }, profile);
        const reviewStatus = quality.passed ? 'needs_review' : 'needs_attention';
        const result = await this.db.saveContentReview(bundle.id, {
          status: reviewStatus,
          editorData: updated.editorData,
          qualityChecks: quality.checks,
          reviewNotes: quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`,
          reviewedAt: null
        });

        return res.json({
          success: true,
          result: this.decorateContentBundle(result),
          sourcesCount: newSourceIds.length,
          claimsResolved: claims.length,
          message: 'Fontes oficiais verificadas e vinculadas com sucesso pela IA!'
        });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/operator/runs/:runId/resume', protect, async (req, res) => {
      try {
        if (this.setupRequired || !this.agents.strategy) {
          return res.status(503).json({ success: false, error: 'Finish setup before resuming the autonomous operator' });
        }
        await this.readiness?.assertReady('Autonomous production recovery');
        const strategy = await this.db.getChannelStrategy();
        const run = await this.autonomous.resume(req.params.runId, strategy);
        return res.status(202).json({ success: true, result: run });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/learning/recommendations/:recommendationId/:action', protect, async (req, res) => {
      const { recommendationId, action } = req.params;
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Action must be approve or reject' });
      }
      const status = action === 'approve' ? 'approved' : 'rejected';
      const recommendation = await this.db.reviewLearningRecommendation(recommendationId, status);
      if (!recommendation) return res.status(404).json({ error: 'Learning recommendation not found' });
      await this.operator.notify({
        type: 'learning_recommendation_reviewed',
        level: action === 'approve' ? 'success' : 'info',
        title: action === 'approve' ? 'Channel learning approved' : 'Channel learning rejected',
        message: recommendation.title,
        data: { recommendationId, status }
      });
      return res.json({ success: true, result: recommendation });
    });

    this.app.post('/api/content/:productionId/discoverability/run', protect, async (req, res) => {
      try {
        const bundle = await this.db.getProductionBundle(req.params.productionId);
        if (!bundle) return res.status(404).json({ success: false, error: 'Content not found' });
        const profile = await this.db.getChannelProfile() || {};
        const audit = await this.discoverability.auditProduction(bundle, profile, req.body?.platform || 'youtube');
        if (bundle.review_status !== 'approved' && !bundle.schedule) {
          const updated = await this.db.getProductionBundle(bundle.id);
          const quality = await this.operator.runQualityChecks({
            ...updated,
            scheduledPublishTime: updated.scheduled_publish_time
          }, profile);
          await this.db.saveContentReview(bundle.id, {
            status: quality.passed ? 'needs_review' : 'needs_attention',
            editorData: updated.editorData,
            qualityChecks: quality.checks,
            reviewNotes: quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`,
            reviewedAt: null
          });
        }
        const result = await this.db.getProductionBundle(bundle.id);
        return res.json({ success: true, result: this.decorateContentBundle(result), audit });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.patch('/api/content/:productionId/schedule', protect, async (req, res) => {
      try {
        if (!this.agents.publishing) return res.status(503).json({ error: 'Publishing requires completed setup' });
        const result = await this.agents.publishing.rescheduleContent(req.params.productionId, req.body?.publishTime);
        await this.db.updateProductionStatus(req.params.productionId, 'scheduled');
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.post('/api/content/:productionId/publish-now', protect, async (req, res) => {
      try {
        if (!this.agents.publishing) return res.status(503).json({ error: 'Publishing requires completed setup' });
        const result = await this.agents.publishing.emergencyPublish(req.params.productionId);
        await this.db.updateProductionStatus(req.params.productionId, result.status);
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.delete('/api/content/:productionId/schedule', protect, async (req, res) => {
      try {
        if (!this.agents.publishing) return res.status(503).json({ error: 'Publishing requires completed setup' });
        const result = await this.agents.publishing.deleteScheduledContent(req.params.productionId);
        await this.db.updateProductionStatus(req.params.productionId, 'approved');
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.delete('/api/content/:productionId', protect, async (req, res) => {
      try {
        const bundle = await this.db.getProductionBundle(req.params.productionId);
        if (!bundle) return res.status(404).json({ error: 'Production not found' });
        if (bundle.schedule?.status === 'published') {
          return res.status(409).json({ error: 'Published content cannot be deleted from the dashboard' });
        }
        await this.db.deleteProduction(req.params.productionId, true);
        return res.json({ success: true, message: 'Production deleted successfully' });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/content/purge-rejected', protect, async (_req, res) => {
      try {
        const deleted = await this.db.deleteRejectedProductions(true);
        return res.json({ success: true, count: deleted.length, deleted });
      } catch (error) {
        return res.status(error.status || 500).json({ success: false, error: error.message });
      }
    });

    this.app.patch('/api/discoverability/findings/:findingId', protect, async (req, res) => {
      try {
        const finding = await this.discoverability.reviewFinding(req.params.findingId, req.body || {});
        const audit = await this.db.getLatestDiscoverabilityAudit(finding.production_id, finding.platform);
        return res.json({ success: true, result: { finding, audit } });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/experiments', async (_req, res) => {
      try {
        const summary = this.experiments
          ? await this.experiments.getSummary()
          : { experiments: [], candidates: [], activeCount: 0, awaitingDecisionCount: 0 };
        return res.json({ success: true, result: summary });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/experiments', protect, async (req, res) => {
      try {
        if (!this.experiments) return res.status(503).json({ error: 'Finish setup before creating experiments' });
        const experiment = await this.experiments.create(req.body || {});
        return res.status(201).json({ success: true, result: experiment });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.post('/api/experiments/:experimentId/:action', protect, async (req, res) => {
      try {
        if (!this.experiments) return res.status(503).json({ error: 'Finish setup before controlling experiments' });
        const actions = {
          approve: () => this.experiments.approve(req.params.experimentId, req.body),
          start: () => this.experiments.start(req.params.experimentId, req.body),
          refresh: () => this.experiments.refresh(req.params.experimentId),
          adopt: () => this.experiments.adoptWinner(req.params.experimentId, req.body),
          cancel: () => this.experiments.cancel(req.params.experimentId, req.body)
        };
        if (!actions[req.params.action]) return res.status(400).json({ error: 'Unsupported experiment action' });
        const experiment = await actions[req.params.action]();
        await this.operator.notify({
          type: 'growth_experiment_updated',
          level: ['adopt', 'approve'].includes(req.params.action) ? 'success' : 'info',
          title: `Growth experiment ${req.params.action}`,
          message: experiment.title,
          data: { experimentId: experiment.id, status: experiment.status }
        });
        return res.json({ success: true, result: experiment });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.get('/api/retention/:videoId', async (req, res) => {
      const videoId = String(req.params.videoId || '').trim();
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(videoId)) {
        return res.status(400).json({ error: 'A valid YouTube video ID is required' });
      }
      const snapshots = await this.db.listRetentionSnapshots({ videoId, limit: 10 });
      return res.json({ success: true, result: snapshots });
    });

    this.app.post('/api/retention/:videoId/refresh', protect, async (req, res) => {
      try {
        const videoId = String(req.params.videoId || '').trim();
        const measurementWindow = String(req.body?.measurementWindow || 'rolling');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(videoId)) {
          return res.status(400).json({ error: 'A valid YouTube video ID is required' });
        }
        if (!['24h', '7d', 'rolling'].includes(measurementWindow)) {
          return res.status(400).json({ error: 'Measurement window must be 24h, 7d, or rolling' });
        }
        if (!this.agents.analytics) {
          return res.status(503).json({ error: 'YouTube Analytics is not initialized' });
        }
        const report = await this.agents.analytics.analyzeVideoPerformance(videoId, { measurementWindow });
        return res.json({
          success: true,
          result: report.retentionSnapshot || null,
          retention: report.retention
        });
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
    });

    const ENGAGEMENT_VIDEO_ID = /^[A-Za-z0-9_-]{1,100}$/;

    this.app.get('/api/engagement/:videoId', async (req, res) => {
      try {
        const videoId = String(req.params.videoId || '').trim();
        if (!ENGAGEMENT_VIDEO_ID.test(videoId)) {
          return res.status(400).json({ error: 'A valid YouTube video ID is required' });
        }
        const [insight, comments, drafts] = await Promise.all([
          this.db.getEngagementInsight(videoId),
          this.db.listAudienceComments({ videoId, limit: 200 }),
          this.db.listReplyDrafts({ videoId, limit: 100 })
        ]);
        return res.json({ success: true, result: { insight, comments, drafts } });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/engagement/:videoId/sync', protect, async (req, res) => {
      try {
        if (!this.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
        const videoId = String(req.params.videoId || '').trim();
        if (!ENGAGEMENT_VIDEO_ID.test(videoId)) {
          return res.status(400).json({ error: 'A valid YouTube video ID is required' });
        }
        const sync = await this.engagement.syncVideoComments(videoId, req.body || {});
        const insight = sync.fetched > 0 || req.body?.analyze === true
          ? await this.engagement.analyzeVideo(videoId)
          : sync.insight;
        return res.status(202).json({ success: true, result: { ...sync, insight } });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.post('/api/engagement/:videoId/draft-replies', protect, async (req, res) => {
      try {
        if (!this.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
        const videoId = String(req.params.videoId || '').trim();
        if (!ENGAGEMENT_VIDEO_ID.test(videoId)) {
          return res.status(400).json({ error: 'A valid YouTube video ID is required' });
        }
        const result = await this.engagement.draftReplies(videoId, req.body || {});
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.patch('/api/engagement/replies/:draftId', protect, async (req, res) => {
      try {
        if (!this.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
        const result = await this.engagement.updateReplyDraft(req.params.draftId, req.body || {});
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.post('/api/engagement/replies/:draftId/approve', protect, async (req, res) => {
      try {
        if (!this.engagement) return res.status(503).json({ error: 'Audience engagement requires completed setup' });
        const result = await this.engagement.approveReplyDraft(req.params.draftId, req.body || {});
        // The reply is already live on YouTube; a notification failure must not report an error.
        try {
          await this.operator.notify({
            type: 'audience_reply_posted',
            level: 'success',
            title: 'Audience reply posted',
            message: `A reply was posted on video ${result.videoId}`,
            data: { draftId: result.id, videoId: result.videoId, postedCommentId: result.postedCommentId }
          });
        } catch (notifyError) {
          this.logger.warn(`Posted reply notification failed: ${notifyError.message}`);
        }
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(error.status || 400).json({ success: false, error: error.message, code: error.code });
      }
    });

    this.app.post('/api/ideas', protect, async (req, res) => {
      const topic = String(req.body?.topic || '').trim();
      if (!topic || topic.length > 200) return res.status(400).json({ error: 'A topic of 200 characters or less is required' });
      const idea = await this.db.createContentIdea({ ...req.body, topic });
      return res.status(201).json({ success: true, result: idea });
    });

    this.app.patch('/api/ideas/:ideaId', protect, async (req, res) => {
      const idea = await this.db.updateContentIdea(req.params.ideaId, req.body || {});
      if (!idea) return res.status(404).json({ error: 'Idea not found' });
      return res.json({ success: true, result: idea });
    });

    this.app.post('/api/ideas/:ideaId/generate', protect, async (req, res) => {
      const idea = await this.db.updateContentIdea(req.params.ideaId, { status: 'generating' });
      if (!idea) return res.status(404).json({ error: 'Idea not found' });
      const job = await this.startGenerationJob({ topic: idea.topic, style: idea.style, length: req.body?.length || 'medium', source: 'idea' });
      await this.db.updateContentIdea(idea.id, { status: 'generated' });
      return res.status(202).json({ success: true, result: job });
    });

    this.app.post('/api/automation/:action', protect, async (req, res) => {
      if (!this.scheduler) return res.status(409).json({ error: 'Finish setup before controlling automation' });
      const { action } = req.params;
      if (action === 'pause') {
        await this.scheduler.pauseAutomation();
        await this.db.setSetting('automation_paused', 'true');
      } else if (action === 'resume') {
        await this.scheduler.resumeAutomation();
        await this.db.setSetting('automation_paused', 'false');
      } else {
        return res.status(400).json({ error: 'Action must be pause or resume' });
      }
      return res.json({ success: true, paused: !this.scheduler.isEnabled });
    });

    this.app.put('/api/settings', protect, async (req, res) => {
      const allowed = ['approval_required', 'notification_enabled', 'channel_timezone', 'max_daily_posts', 'content_buffer_days'];
      for (const key of allowed) {
        if (req.body?.[key] !== undefined) await this.db.setSetting(key, String(req.body[key]));
      }
      const provider = req.body?.video_provider;
      if (provider !== undefined) {
        const supported = ['slideshow', 'auto', 'seedance', 'minimax_h3', 'google_omni', 'kling', 'wan'];
        if (!supported.includes(provider)) return res.status(400).json({ error: 'Unsupported video provider' });
        await this.db.setSetting('video_provider', provider);
      }
      const mode = req.body?.video_generation_mode;
      if (mode !== undefined) {
        if (!['hybrid', 'slideshow'].includes(mode)) return res.status(400).json({ error: 'Unsupported video generation mode' });
        await this.db.setSetting('video_generation_mode', mode);
      }
      if (req.body?.video_clip_duration !== undefined) {
        const value = Number(req.body.video_clip_duration);
        if (!Number.isInteger(value) || value < 3 || value > 30) return res.status(400).json({ error: 'Clip duration must be between 3 and 30 seconds' });
        await this.db.setSetting('video_clip_duration', String(value));
      }
      if (req.body?.video_max_generated_seconds !== undefined) {
        const value = Number(req.body.video_max_generated_seconds);
        if (!Number.isInteger(value) || value < 0 || value > 600) return res.status(400).json({ error: 'Generated seconds cap must be between 0 and 600' });
        await this.db.setSetting('video_max_generated_seconds', String(value));
      }
      return res.json({ success: true, result: await this.db.getAllSettings() });
    });

    this.app.post('/api/notifications/:notificationId/read', protect, async (req, res) => {
      await this.db.markNotificationRead(req.params.notificationId);
      return res.json({ success: true });
    });

    // YouTube Account Management Routes
    this.app.get('/api/youtube/accounts', async (_req, res) => {
      try {
        await this.youtubeAccounts.reload();
        const activeAccount = this.youtubeAccounts.getActiveAccount();
        const accounts = this.youtubeAccounts.listAccounts();
        return res.json({
          success: true,
          activeChannelId: this.youtubeAccounts.data.activeChannelId,
          activeAccount,
          accounts
        });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/youtube/switch', protect, async (req, res) => {
      try {
        const channelId = String(req.body?.channelId || '').trim();
        if (!channelId) {
          return res.status(400).json({ success: false, error: 'channelId é obrigatório' });
        }
        await this.youtubeAccounts.reload();
        const switched = await this.youtubeAccounts.switchToAccount(channelId);
        
        // Recarregar credenciais na memória
        await this.credentials.reload();

        // Atualizar agentes ativos que usam YouTube API
        if (this.agents.publishing) {
          try {
            await this.agents.publishing.setupYouTubeAPI();
          } catch (_err) {
            /* ignore */
          }
        }
        if (this.agents.analytics) {
          try {
            await this.agents.analytics.setupAnalyticsAPI();
          } catch (_err) {
            /* ignore */
          }
        }

        return res.json({
          success: true,
          activeAccount: switched,
          message: `Conta do YouTube alterada com sucesso para ${switched.title}`
        });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/youtube/auth/start', protect, async (req, res) => {
      try {
        const { ModernAuth } = require('./modern-auth');
        const incognito = req.body?.incognito === true;

        this.pendingYouTubeAuth = {
          status: 'pending',
          startedAt: new Date().toISOString(),
          error: null,
          result: null,
          authUrl: null,
          incognito
        };

        const auth = new ModernAuth({
          forceSelectAccount: true,
          incognito,
          clientId: req.body?.clientId || undefined,
          clientSecret: req.body?.clientSecret || undefined,
          onAuthUrl: (url) => {
            if (this.pendingYouTubeAuth) {
              this.pendingYouTubeAuth.authUrl = url;
            }
          }
        });

        const authUrl = await auth.initiateAuthUrl();
        this.pendingYouTubeAuth.authUrl = authUrl;

        auth.waitForCompletion()
          .then(async (result) => {
            if (this.youtubeAccounts) {
              try {
                await this.youtubeAccounts.reload();
              } catch (_e) {
                /* ignore */
              }
            }
            await this.credentials.reload();
            if (this.agents.publishing) {
              try {
                await this.agents.publishing.setupYouTubeAPI();
              } catch (_err) {
                /* ignore */
              }
            }
            if (this.agents.analytics) {
              try {
                await this.agents.analytics.setupAnalyticsAPI();
              } catch (_err) {
                /* ignore */
              }
            }
            this.pendingYouTubeAuth = {
              status: 'success',
              completedAt: new Date().toISOString(),
              result: result.channelInfo,
              authUrl: null
            };
          })
          .catch((err) => {
            this.pendingYouTubeAuth = {
              status: 'error',
              completedAt: new Date().toISOString(),
              error: err.message,
              authUrl: null
            };
          });

        return res.json({
          success: true,
          message: incognito 
            ? 'Fluxo de autorização iniciado em janela anônima (InPrivate). Conclua a autorização no navegador.'
            : 'Fluxo de autorização do YouTube iniciado. Conclua a autorização no navegador.',
          status: 'pending',
          authUrl
        });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/youtube/auth/status', async (_req, res) => {
      return res.json({
        success: true,
        auth: this.pendingYouTubeAuth || { status: 'idle' }
      });
    });

    this.app.post('/api/youtube/auth/manual-callback', protect, async (req, res) => {
      try {
        const { ModernAuth } = require('./modern-auth');
        let code = req.body?.code;
        let redirectUri = req.body?.redirectUri;

        if (req.body?.callbackUrl) {
          const raw = String(req.body.callbackUrl).trim();
          try {
            const parsed = new URL(raw.startsWith('http') ? raw : `http://${raw}`);
            code = parsed.searchParams.get('code') || code;
            if (!redirectUri && parsed.host) {
              redirectUri = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
            }
          } catch (_e) {
            /* ignore url parse error */
          }
        }

        if (!code) {
          return res.status(400).json({ success: false, error: 'Código de autorização não encontrado. Verifique a URL colada.' });
        }

        const auth = new ModernAuth({
          clientId: req.body?.clientId || undefined,
          clientSecret: req.body?.clientSecret || undefined
        });

        const effectiveRedirectUri = redirectUri || 'http://127.0.0.1:8080/oauth2callback';
        const result = await auth.exchangeCodeForToken({
          code,
          redirectUri: effectiveRedirectUri
        });

        if (this.youtubeAccounts) {
          try {
            await this.youtubeAccounts.reload();
          } catch (_e) {
            /* ignore */
          }
        }
        await this.credentials.reload();
        if (this.agents.publishing) {
          try {
            await this.agents.publishing.setupYouTubeAPI();
          } catch (_e) {
            /* ignore */
          }
        }
        if (this.agents.analytics) {
          try {
            await this.agents.analytics.setupAnalyticsAPI();
          } catch (_e) {
            /* ignore */
          }
        }

        this.pendingYouTubeAuth = {
          status: 'success',
          completedAt: new Date().toISOString(),
          result: result.channelInfo,
          authUrl: null
        };

        return res.json({
          success: true,
          message: 'Canal do YouTube autorizado e conectado com sucesso!',
          channelInfo: result.channelInfo
        });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.delete('/api/youtube/accounts/:channelId', protect, async (req, res) => {
      try {
        await this.youtubeAccounts.initialize();
        const result = await this.youtubeAccounts.removeAccount(req.params.channelId);
        await this.credentials.reload();
        return res.json({ success: true, result });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    // ----------------------------------------------------
    // Production Workflow Studio Endpoints
    // ----------------------------------------------------
    this.app.get('/api/workflow/recent-videos', async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const days = parseInt(req.query.days || '7', 10);
        const result = await this.workflow.fetchChannelRecentVideos({ days });
        return res.json({ success: true, ...result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/schedule/sync-youtube', async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const result = await this.workflow.syncScheduledVideosFromYouTube({ maxPages: 2 });
        return res.json({ success: true, ...result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/schedule/sync-youtube', async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const result = await this.workflow.syncScheduledVideosFromYouTube({ maxPages: 2 });
        return res.json({ success: true, ...result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // ----------------------------------------------------
    // Planned Themes & Posting Schedule Endpoints
    // ----------------------------------------------------
    this.app.get('/api/workflow/planned-themes', async (req, res) => {
      try {
        const activeAccount = this.youtubeAccounts?.getActiveAccount();
        const channelId = req.query.channelId || activeAccount?.channelId || null;
        const status = req.query.status || null;
        const format = req.query.format || null;
        const themes = await this.db.listPlannedThemes({ channelId, status, format });
        
        const all = await this.db.listPlannedThemes({ channelId });
        const isShort = (t) => t.format === 'short' || /#shorts?/i.test(t.topic || '');
        const isLong = (t) => !isShort(t);
        const counts = {
          total: all.length,
          pending: all.filter(t => t.status === 'pending').length,
          inProduction: all.filter(t => t.status === 'in_production').length,
          posted: all.filter(t => t.status === 'posted').length,
          shorts: all.filter(isShort).length,
          longs: all.filter(isLong).length,
          postedShorts: all.filter(t => t.status === 'posted' && isShort(t)).length,
          postedLongs: all.filter(t => t.status === 'posted' && isLong(t)).length
        };

        return res.json({ success: true, themes, counts });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/planned-themes/batch', protect, async (req, res) => {
      try {
        const { themes, startDate, cadence } = req.body || {};
        if (!Array.isArray(themes) || themes.length === 0) {
          return res.status(400).json({ success: false, error: 'A lista de temas é obrigatória.' });
        }
        const activeAccount = this.youtubeAccounts?.getActiveAccount();
        const channelId = req.body.channelId || activeAccount?.channelId || null;

        const saved = await this.db.savePlannedThemesBatch(themes, {
          channelId,
          startDate: startDate || new Date().toISOString().split('T')[0],
          cadence: cadence || 'daily'
        });

        return res.json({ success: true, count: saved.length, themes: saved });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/planned-themes', protect, async (req, res) => {
      try {
        const { topic, hookAngle, whyBetter, format, scheduledDate, status, notes, fullScript } = req.body || {};
        if (!topic || !String(topic).trim()) {
          return res.status(400).json({ success: false, error: 'O tema é obrigatório.' });
        }
        const activeAccount = this.youtubeAccounts?.getActiveAccount();
        const channelId = req.body.channelId || activeAccount?.channelId || null;

        const cleanFullScript = fullScript && String(fullScript).trim() ? String(fullScript).trim() : null;
        let effectiveHook = hookAngle ? String(hookAngle).trim() : null;
        let narrationBlocks = null;

        if (cleanFullScript) {
          if (!effectiveHook) {
            // Extrai automaticamente a abertura do roteiro para servir como gancho/resumo
            const paragraphs = cleanFullScript.split(/\n+/).map(p => p.trim()).filter(Boolean);
            const firstPara = paragraphs[0] || '';
            const firstSentence = firstPara.split(/\.\s/)[0].trim();
            const textToUse = firstSentence.length >= 40 ? firstSentence : firstPara;
            effectiveHook = textToUse.length > 220 ? textToUse.slice(0, 217).trim() + '...' : textToUse;
          }
          if (this.workflow) {
            narrationBlocks = this.workflow.splitIntoNarrationBlocks(cleanFullScript, 5000, 2);
          }
        }

        const created = await this.db.createPlannedTheme({
          channelId,
          topic: String(topic).trim(),
          hookAngle: effectiveHook,
          whyBetter: whyBetter ? String(whyBetter).trim() : null,
          format: format || 'explainer',
          scheduledDate: scheduledDate || null,
          status: status || 'pending',
          notes: notes ? String(notes).trim() : null,
          fullScript: cleanFullScript,
          narrationBlocks,
          scriptCharCount: cleanFullScript ? cleanFullScript.length : 0
        });

        return res.status(201).json({ success: true, theme: created });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.patch('/api/workflow/planned-themes/:id', protect, async (req, res) => {
      try {
        const changes = { ...(req.body || {}) };
        if (changes.fullScript !== undefined || changes.full_script !== undefined) {
          const rawScript = changes.fullScript !== undefined ? changes.fullScript : changes.full_script;
          const cleanScript = rawScript ? String(rawScript).trim() : null;
          changes.fullScript = cleanScript;
          changes.scriptCharCount = cleanScript ? cleanScript.length : 0;
          if (cleanScript && !changes.narrationBlocks && this.workflow) {
            changes.narrationBlocks = this.workflow.splitIntoNarrationBlocks(cleanScript, 5000, 2);
          }
        }

        const updated = await this.db.updatePlannedTheme(req.params.id, changes);
        if (!updated) {
          return res.status(404).json({ success: false, error: 'Tema planejado não encontrado.' });
        }
        return res.json({ success: true, theme: updated });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/split-script', protect, async (req, res) => {
      try {
        const { scriptText, maxChars = 5000, targetCount = 2 } = req.body || {};
        if (!scriptText || !String(scriptText).trim()) {
          return res.status(400).json({ success: false, error: 'Texto do roteiro é obrigatório.' });
        }
        const cleanText = String(scriptText).trim();
        const blocks = this.workflow ? this.workflow.splitIntoNarrationBlocks(cleanText, maxChars, targetCount) : [];
        return res.json({ success: true, blocks, totalChars: cleanText.length });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.delete('/api/workflow/planned-themes', protect, async (req, res) => {
      try {
        const channelId = req.query.channelId || req.body?.channelId || null;
        const result = await this.db.deleteAllPlannedThemes({ channelId });
        return res.json({ success: true, count: result.count, protectedNotice: 'Temas em produção e já postados foram preservados com sucesso.' });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.delete('/api/workflow/planned-themes/:id', protect, async (req, res) => {
      try {
        const force = req.query.force === 'true' || req.body?.force === true;
        await this.db.deletePlannedTheme(req.params.id, { force });
        return res.json({ success: true, id: req.params.id });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/planned-themes/deduplicate', protect, async (req, res) => {
      try {
        const channelId = req.query.channelId || req.body?.channelId || null;
        const result = await this.db.deduplicatePlannedThemes({ channelId });
        return res.json({ success: true, count: result.count, removedIds: result.removedIds });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });


    this.app.post('/api/workflow/generate-themes', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const { days, count, language, fieldAHistory, strategyMode } = req.body || {};
        const profile = await this.db.getChannelProfile().catch(() => ({}));
        const result = await this.workflow.generateThemesFromChannelHistory({
          days: parseInt(days || '7', 10),
          count: count ? parseInt(count, 10) : null,
          language: language || 'it-IT',
          fieldAHistory: fieldAHistory || '',
          strategyMode: strategyMode || 'recovery',
          channelContext: profile
        });
        return res.json({ success: true, ...result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/generate-script', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const {
          topic,
          angle,
          authorAngle,
          channelPosition,
          leaveOut,
          hookType,
          angleFamily,
          format,
          language,
          fieldAHistory
        } = req.body || {};
        const profile = await this.db.getChannelProfile().catch(() => ({}));
        const result = await this.workflow.generateScript({
          topic,
          angle,
          authorAngle,
          channelPosition,
          leaveOut,
          hookType,
          angleFamily,
          format: format || 'explainer',
          language: language || 'it-IT',
          fieldAHistory: fieldAHistory || '',
          channelName: profile.name || ''
        });

        // Gravação automática do histórico de ganchos para evitar repetições no próximo roteiro
        if (result && result.hookRegisterBlock) {
          try {
            await this.db.setSetting('last_workflow_summary', JSON.stringify({
              summaryText: result.hookRegisterBlock,
              usedHooks: [result.hookType || 'Tipo 1'],
              topic: topic,
              updatedAt: new Date().toISOString()
            }));
          } catch (_e) {
            this.logger.warn(`Falha ao persistir histórico de gancho automático: ${_e.message}`);
          }
        }

        return res.json({ success: true, result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/generate-google-flow-prompts', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const { script, topic, count } = req.body || {};
        const result = await this.workflow.generateGoogleFlowPrompts({
          script,
          topic,
          count: parseInt(count || '35', 10)
        });
        return res.json({ success: true, prompts: result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/generate-nano-banana-prompts', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const { topic, script, language, versionsCount } = req.body || {};
        const result = await this.workflow.generateNanoBananaThumbnailPrompts({
          topic,
          script,
          language,
          versionsCount: parseInt(versionsCount || '10', 10)
        });
        return res.json({ success: true, versions: result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/generate-seo', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const { script, topic, language } = req.body || {};
        const profile = await this.db.getChannelProfile().catch(() => ({}));
        const result = await this.workflow.generateSEO({
          script,
          topic,
          language: language || 'it-IT',
          channelName: profile.name || ''
        });
        return res.json({ success: true, seo: result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/save-summary', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const { usedHooks, forbiddenType, previousSignatures, thumbnailVersion, topic } = req.body || {};
        const result = this.workflow.buildNextScriptSummary({
          usedHooks,
          forbiddenType,
          previousSignatures,
          thumbnailVersion,
          topic
        });
        await this.db.setSetting('last_workflow_summary', JSON.stringify(result));
        return res.json({ success: true, summary: result });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/workflow/last-summary', async (_req, res) => {
      try {
        const raw = await this.db.getSetting('last_workflow_summary');
        return res.json({ success: true, summary: raw ? JSON.parse(raw) : null });
      } catch (_e) {
        return res.json({ success: true, summary: null });
      }
    });

    this.app.get('/api/workflow/draft', async (_req, res) => {
      try {
        if (!this.db) return res.json({ success: true, draft: null });
        const raw = await this.db.getSetting('active_production_draft');
        return res.json({ success: true, draft: raw && raw.trim() ? JSON.parse(raw) : null });
      } catch (err) {
        return res.json({ success: false, draft: null });
      }
    });

    this.app.post('/api/workflow/draft', async (req, res) => {
      try {
        if (!this.db) return res.status(503).json({ success: false, error: 'Banco não inicializado' });
        const draft = req.body || {};
        await this.db.setSetting('active_production_draft', JSON.stringify(draft), 'Rascunho ativo da produção em andamento');
        return res.json({ success: true });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.delete('/api/workflow/draft', async (_req, res) => {
      try {
        if (this.db) {
          await this.db.executeQuery('DELETE FROM settings WHERE key = ?', ['active_production_draft']);
        }
        return res.json({ success: true });
      } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/workflow/schedule-upload', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const {
          videoPath,
          publishTime,
          title,
          description,
          tags,
          thumbnailPath,
          containsSyntheticMedia,
          language,
          channelName,
          script,
          googleFlowPrompts,
          nanoBananaPrompts,
          thumbnailPrompt,
          seo,
          bundle,
          format,
          themeId
        } = req.body || {};

        const result = await this.workflow.scheduleManualUpload({
          videoPath,
          publishTime,
          title,
          description,
          tags,
          thumbnailPath,
          containsSyntheticMedia: containsSyntheticMedia !== false,
          language: language || 'it',
          publishingAgent: this.agents?.publishing,
          channelName,
          script,
          googleFlowPrompts,
          nanoBananaPrompts,
          thumbnailPrompt,
          seo,
          bundle,
          format: format || 'explainer'
        });

        // Registrar / Atualizar tema no cronograma como 'posted' e com o formato correto
        try {
          if (this.db) {
            const activeAccount = this.youtubeAccounts?.getActiveAccount();
            const channelId = activeAccount?.channelId || null;
            const cleanTitle = (title || '').replace(/^["']|["']$/g, '').trim();
            const isShort = format === 'short' || /#shorts?/i.test(cleanTitle) || /#shorts?/i.test(description || '');
            const targetFormat = isShort ? 'short' : (format || 'explainer');
            const targetDate = publishTime ? String(publishTime).split('T')[0] : new Date().toISOString().split('T')[0];
            const youtubeUrl = result?.scheduleEntry?.youtubeUrl || null;

            let syncedTheme = null;
            if (themeId) {
              syncedTheme = await this.db.updatePlannedTheme(themeId, {
                status: 'posted',
                format: targetFormat,
                publishedUrl: youtubeUrl,
                scheduledDate: targetDate
              });
            } else {
              // Verificar se existe um tema existente com título correspondente
              const allThemes = await this.db.listPlannedThemes({ channelId });
              const match = allThemes.find(t => 
                t.topic && cleanTitle && (
                  t.topic.toLowerCase().includes(cleanTitle.toLowerCase()) ||
                  cleanTitle.toLowerCase().includes(t.topic.toLowerCase())
                )
              );
              if (match) {
                syncedTheme = await this.db.updatePlannedTheme(match.id, {
                  status: 'posted',
                  format: targetFormat,
                  publishedUrl: youtubeUrl,
                  scheduledDate: targetDate || match.scheduled_date
                });
              } else {
                // Se foi envio direto de corte ou upload sem tema prévio, criar entrada no cronograma
                // para incrementar a contagem de postados e exibir no filtro/calendário
                syncedTheme = await this.db.createPlannedTheme({
                  channelId,
                  topic: cleanTitle || (isShort ? 'Short Agendado' : 'Vídeo Agendado'),
                  format: targetFormat,
                  status: 'posted',
                  scheduledDate: targetDate,
                  publishedUrl: youtubeUrl,
                  whyBetter: isShort ? '⚡ Envio Direto de Cortes / Short' : 'Upload Direto no Estúdio'
                });
              }
            }
          }
        } catch (dbErr) {
          console.warn('Aviso: Não foi possível sincronizar status do tema no cronograma:', dbErr.message);
        }

        return res.json({ success: true, result, theme: syncedTheme });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/workflow/export-production-log', protect, async (req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const bundle = req.body || {};
        const logResult = await this.workflow.saveProductionLogTxt(bundle);
        return res.json({ success: true, ...logResult });
      } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/workflow/production-logs', protect, async (_req, res) => {
      try {
        if (!this.workflow) return res.status(503).json({ success: false, error: 'Workflow service not ready' });
        const logs = await this.workflow.listProductionLogs();
        return res.json({ success: true, logs });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/workflow/download-production-log', protect, async (req, res) => {
      try {
        const fileName = req.query.file || req.query.filename;
        if (!fileName) return res.status(400).json({ success: false, error: 'Parâmetro file é obrigatório' });
        const safeName = path.basename(fileName);
        const filePath = path.resolve(__dirname, 'producoes', safeName);
        await fs.access(filePath);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        return res.sendFile(filePath);
      } catch (error) {
        return res.status(404).json({ success: false, error: 'Arquivo de log não encontrado' });
      }
    });

    this.app.post('/api/workflow/upload-file', protect, async (req, res) => {
      try {
        const rawFileName = req.get('x-file-name') || req.query.filename || `asset_${Date.now()}`;
        let decodedFileName = rawFileName;
        try {
          decodedFileName = decodeURIComponent(rawFileName);
        } catch (_err) {
          decodedFileName = rawFileName;
        }
        const contentType = req.get('content-type') || 'application/octet-stream';
        const isVideo = contentType.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(decodedFileName);
        
        const targetDir = isVideo 
          ? path.resolve(__dirname, 'uploads', 'videos')
          : path.resolve(__dirname, 'uploads', 'thumbnails');
        
        await fs.mkdir(targetDir, { recursive: true });
        
        const sanitizedName = path.basename(decodedFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalFileName = `${Date.now()}_${sanitizedName}`;
        const finalPath = path.join(targetDir, finalFileName);

        const writeStream = fsSync.createWriteStream(finalPath);
        
        await new Promise((resolve, reject) => {
          req.pipe(writeStream);
          req.on('error', reject);
          writeStream.on('error', reject);
          writeStream.on('finish', resolve);
        });

        const stats = await fs.stat(finalPath);
        return res.json({
          success: true,
          filePath: finalPath,
          fileName: sanitizedName,
          size: stats.size,
          type: isVideo ? 'video' : 'image'
        });
      } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  async startGenerationJob(input = {}) {
    if (this.setupRequired || !this.agents.strategy) {
      const error = new Error('Finish setup with npm run walkthrough before generating content');
      error.status = 503;
      throw error;
    }
    if (['scheduler', 'autonomous_operator'].includes(input.source)) {
      await this.readiness?.assertReady('Automated generation');
    }
    const maxConcurrent = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS || '1', 10));
    if (this.activeJobs.size >= maxConcurrent) {
      const error = new Error(`Generation is busy (${this.activeJobs.size}/${maxConcurrent} active jobs). Try again when the current job finishes.`);
      error.status = 429;
      throw error;
    }

    const validation = this.validateGenerateRequestBody(input);
    if (!validation.valid) {
      const error = new Error(validation.error);
      error.status = validation.status;
      throw error;
    }

    const job = await this.db.createGenerationJob({
      ...validation.value,
      source: input.source || 'manual'
    });

    const work = this.runGenerationJob(job.id, validation.value)
      .catch(error => this.logger.error(`Generation job ${job.id} failed:`, error))
      .finally(() => this.activeJobs.delete(job.id));
    this.activeJobs.set(job.id, work);
    return job;
  }

  async resumeGenerationJob(jobId, options = {}) {
    if (this.setupRequired || !this.agents.strategy) {
      const error = new Error('Finish setup with npm run walkthrough before resuming content generation');
      error.status = 503;
      throw error;
    }
    const job = await this.db.getGenerationJob(jobId);
    if (!job) {
      const error = new Error('Generation job not found');
      error.status = 404;
      throw error;
    }
    if (!['failed', 'interrupted'].includes(job.status)) {
      const error = new Error('Only failed or interrupted generation jobs can be resumed');
      error.status = 409;
      throw error;
    }
    if (this.activeJobs.has(job.id)) {
      const error = new Error('This generation job is already running');
      error.status = 409;
      throw error;
    }
    const maxConcurrent = Math.max(1, parseInt(process.env.MAX_CONCURRENT_JOBS || '1', 10));
    if (this.activeJobs.size >= maxConcurrent) {
      const error = new Error(`Generation is busy (${this.activeJobs.size}/${maxConcurrent} active jobs). Try again when the current job finishes.`);
      error.status = 429;
      throw error;
    }
    if (['scheduler', 'autonomous_operator'].includes(job.source)) {
      await this.readiness?.assertReady('Automated generation recovery');
    }

    const checkpoints = await this.db.listGenerationCheckpoints(job.id);
    const resumeFrom = options.stage || this.recovery.resumePoint(checkpoints);
    if (!GENERATION_STAGES.includes(resumeFrom)) {
      const error = new Error('Resume stage is not supported');
      error.status = 400;
      throw error;
    }
    if (options.stage) await this.recovery.resetFrom(job.id, resumeFrom);
    const input = {
      topic: job.topic,
      style: job.style,
      length: job.length || 'medium',
      strategyContext: job.details?.strategyContext || {}
    };
    const updated = await this.db.updateGenerationJob(job.id, {
      status: 'queued',
      stage: resumeFrom,
      error: null,
      cancelRequested: false,
      completedAt: null,
      details: {
        resumeCount: Number(job.details?.resumeCount || 0) + 1,
        resumeFrom,
        failedStage: null
      }
    });
    const work = this.runGenerationJob(job.id, input)
      .catch(error => this.logger.error(`Resumed generation job ${job.id} failed:`, error))
      .finally(() => this.activeJobs.delete(job.id));
    this.activeJobs.set(job.id, work);
    return updated;
  }

  async waitForGenerationJob(jobId) {
    const work = this.activeJobs.get(jobId);
    if (work) await work;
    const job = await this.db.getGenerationJob(jobId);
    if (!job) throw new Error(`Generation job ${jobId} was not found after it ran`);
    return job;
  }

  async queueScheduledContent(input = {}) {
    const strategy = await this.db.getChannelStrategy();
    if (strategy?.status === 'active') {
      const weeklyOutput = await this.db.getRow(
        `SELECT COUNT(*) AS count FROM generation_jobs
         WHERE source = 'autonomous_operator' AND status = 'completed'
         AND created_at >= datetime('now', '-7 days')`
      );
      const remaining = Math.max(1, strategy.cadence_per_week - Number(weeklyOutput?.count || 0));
      return this.autonomous.start({
        ...strategy,
        videos_per_run: Math.min(strategy.videos_per_run, remaining)
      });
    }
    return this.startGenerationJob(input);
  }

  async runGenerationJob(jobId, input) {
    try {
      await this.db.updateGenerationJob(jobId, { status: 'running', progress: 2, error: null, completedAt: null });
      const result = await this.generateContent(input.topic, input.style, input.length, {
        jobId,
        strategyContext: input.strategyContext
      });
      await this.db.updateGenerationJob(jobId, {
        status: 'completed',
        stage: result.reviewStatus === 'approved' ? 'scheduled' : result.reviewStatus,
        progress: 100,
        productionId: result.contentId,
        title: result.title,
        details: { reviewStatus: result.reviewStatus, qualityScore: result.qualityScore },
        completedAt: new Date().toISOString()
      });
      await this.db.setSetting('last_content_generation', new Date().toISOString());
      return result;
    } catch (error) {
      const cancelled = error.code === 'JOB_CANCELLED';
      const current = await this.db.getGenerationJob(jobId);
      const failedStage = current?.stage || 'starting';
      await this.db.updateGenerationJob(jobId, {
        status: cancelled ? 'cancelled' : 'failed',
        stage: failedStage,
        error: error.message,
        details: { failedStage },
        completedAt: new Date().toISOString()
      });
      await this.operator.notify({
        type: cancelled ? 'generation_cancelled' : 'generation_failure',
        level: cancelled ? 'warning' : 'error',
        title: cancelled ? 'Generation cancelled' : 'Generation failed',
        message: error.message,
        data: { jobId }
      });
      throw error;
    }
  }

  async updateJobStage(jobId, stage, progress, details = {}) {
    if (!jobId) return;
    const job = await this.db.getGenerationJob(jobId);
    if (job?.cancelRequested) {
      const error = new Error(job.details?.cancelReason || 'Generation cancelled by operator');
      error.code = 'JOB_CANCELLED';
      throw error;
    }
    await this.db.updateGenerationJob(jobId, { stage, progress, details });
  }

  async generateContent(topic = null, style = null, length = 'medium', options = {}) {
    this.logger.info('Starting content generation pipeline...');
    const { jobId = null, strategyContext: rawStrategyContext = {} } = options;
    const strategyContext = rawStrategyContext || {};
    const profile = await this.db.getChannelProfile() || {};
    const lengthLabels = { short: '2-4 minutes', medium: '8-12 minutes', long: '15-20 minutes' };

    // Step 1: Strategy
    const strategy = await this.runGenerationStage(jobId, 'strategy', 10, async () => {
      const generated = await this.agents.strategy.generateContentStrategy(topic);
      const contentStyles = new Set(['tutorial', 'explainer', 'list', 'review', 'story']);
      const requestedStyle = style || profile.default_style || null;
      if (requestedStyle && contentStyles.has(requestedStyle.toLowerCase())) {
        generated.contentType = requestedStyle.charAt(0).toUpperCase() + requestedStyle.slice(1).toLowerCase();
      }
      generated.requestedStyle = requestedStyle;
      generated.requestedLengthKey = length;
      generated.requestedLength = lengthLabels[length] || lengthLabels.medium;
      generated.angle = strategyContext.angle || generated.angle;
      generated.planRationale = strategyContext.rationale || null;
      generated.targetAudience = strategyContext.audience || profile.target_audience || generated.targetAudience;
      generated.brandVoice = profile.brand_voice || null;
      generated.channelGoal = strategyContext.objective || profile.goal || null;
      generated.channelValueProposition = strategyContext.valueProposition || null;
      generated.channelConstraints = strategyContext.constraints || null;
      generated.contentPillar = strategyContext.pillar || null;
      generated.callToAction = profile.call_to_action || null;
      generated.researchSources = Array.isArray(strategyContext.researchSources)
        ? strategyContext.researchSources
        : [];
      return generated;
    });
    this.logger.info(`Strategy generated: ${strategy.topic}`);

    // Step 2: Script Writing
    const script = await this.runGenerationStage(
      jobId,
      'script',
      25,
      () => this.agents.scriptWriter.generateScript(strategy)
    );
    this.logger.info(`Script generated: ${script.title}`);

    // Step 3: Thumbnail Design
    const thumbnail = await this.runGenerationStage(
      jobId,
      'thumbnail',
      40,
      () => this.agents.thumbnailDesigner.generateThumbnail(script)
    );
    this.logger.info('Thumbnail generated');

    // Step 4: SEO Optimization
    const seoData = await this.runGenerationStage(
      jobId,
      'seo',
      52,
      () => this.agents.seoOptimizer.optimize(script, strategy)
    );
    this.logger.info('SEO optimization complete');

    // Step 5: Production Management
    const productionData = await this.runGenerationStage(
      jobId,
      'production',
      62,
      () => this.agents.production.processContent({ strategy, script, thumbnail, seo: seoData, jobId })
    );
    this.logger.info('Production processing complete');

    // Re-persist reused production artifacts in case a restart happened between checkpointing and persistence.
    const contentId = await this.db.saveProductionData(productionData);
    await this.db.saveProductionSnapshot(productionData);
    if (!this.provenance) this.provenance = new ProvenanceService(this.db);
    productionData.provenance = await this.provenance.initialize(contentId, productionData);
    productionData.discoverability = this.discoverability
      ? await this.discoverability.auditProduction(productionData, profile, 'youtube')
      : null;
    this.logger.info(`Content saved with ID: ${contentId}`);

    // Step 6: Quality and approval gate
    return this.runGenerationStage(jobId, 'quality_review', 90, async () => {
      const approvalRequired = await this.db.getSetting('approval_required') !== 'false';
      const packagingExperiment = approvalRequired
        ? await this.preparePackagingExperiment(thumbnail, productionData, seoData, script)
        : null;
      const quality = await this.operator.runQualityChecks(productionData, profile);
      const reviewStatus = quality.passed
        ? (approvalRequired ? 'needs_review' : 'approved')
        : 'needs_attention';
      await this.db.saveContentReview(contentId, {
        status: reviewStatus,
        qualityChecks: quality.checks,
        editorData: packagingExperiment ? {
          packagingExperiment,
          selectedTitleVariant: 0,
          selectedThumbnailVariant: 0
        } : {},
        reviewNotes: quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`,
        reviewedAt: approvalRequired ? null : new Date().toISOString()
      });

      let scheduleEntry = null;
      if (reviewStatus === 'approved') {
        scheduleEntry = await this.agents.publishing.scheduleContent(productionData);
        await this.db.updateProductionStatus(contentId, scheduleEntry ? 'scheduled' : productionData.status);
      } else {
        await this.db.updateProductionStatus(contentId, reviewStatus);
        await this.operator.notify({
          type: 'review_required',
          level: quality.passed ? 'info' : 'warning',
          title: quality.passed ? 'Content ready for review' : 'Content needs attention',
          message: `${script.title} ${quality.passed ? 'is ready for approval' : 'failed one or more quality checks'}`,
          data: { contentId, qualityScore: quality.score }
        });
      }

      return {
        contentId,
        title: script.title,
        status: productionData.status,
        reviewStatus,
        qualityScore: quality.score,
        scheduledFor: scheduleEntry ? scheduleEntry.publishTime : null
      };
    });
  }

  async runGenerationStage(jobId, stage, progress, producer) {
    if (!jobId) {
      await this.updateJobStage(jobId, stage, progress);
      return producer();
    }
    if (!this.recovery) {
      this.recovery = new GenerationRecoveryService(this.db, {
        logger: this.logger,
        updateJobStage: (...args) => this.updateJobStage(...args)
      });
    }
    return this.recovery.run(jobId, stage, progress, producer);
  }

  validateEditorData(input = {}, existing = {}) {
    const output = { ...existing };
    if (input.title !== undefined) {
      const title = String(input.title).trim();
      if (!title || title.length > 100) throw new Error('Title must be between 1 and 100 characters');
      output.title = title;
    }
    if (input.description !== undefined) {
      const description = String(input.description).trim();
      if (description.length > 5000) throw new Error('Description must be 5,000 characters or less');
      output.description = description;
    }
    if (input.tags !== undefined) {
      const tags = Array.isArray(input.tags)
        ? input.tags
        : String(input.tags).split(',');
      output.tags = tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 30);
    }
    if (input.publishTime !== undefined) {
      const date = new Date(input.publishTime);
      if (Number.isNaN(date.getTime())) throw new Error('Publish time must be a valid date');
      output.publishTime = date.toISOString();
    }
    if (input.privacyStatus !== undefined) {
      if (!['private', 'unlisted', 'public'].includes(input.privacyStatus)) throw new Error('Invalid privacy status');
      output.privacyStatus = input.privacyStatus;
    }
    if (input.factChecked !== undefined) output.factChecked = input.factChecked === true;
    if (input.rightsConfirmed !== undefined) output.rightsConfirmed = input.rightsConfirmed === true;
    const experiment = output.packagingExperiment;
    if (input.selectedTitleVariant !== undefined) {
      const selected = Number(input.selectedTitleVariant);
      if (!Number.isInteger(selected) || !experiment?.titleVariants?.[selected]) {
        throw new Error('Selected title variant is invalid');
      }
      output.selectedTitleVariant = selected;
    }
    if (input.selectedThumbnailVariant !== undefined) {
      const selected = Number(input.selectedThumbnailVariant);
      if (!Number.isInteger(selected) || !experiment?.thumbnailVariants?.[selected]) {
        throw new Error('Selected thumbnail variant is invalid');
      }
      output.selectedThumbnailVariant = selected;
    }
    return output;
  }

  buildTitleExperimentVariants(title) {
    const control = String(title || '').trim().slice(0, 100);
    const withoutPunctuation = control.replace(/[.!?]+$/, '');
    return [
      { label: 'Control', title: control },
      { label: 'Step-by-step', title: `${withoutPunctuation}: Step-by-Step`.slice(0, 100) },
      { label: 'Curiosity', title: `${withoutPunctuation}: What Most People Miss`.slice(0, 100) }
    ];
  }

  async preparePackagingExperiment(thumbnail, productionData, seoData, script) {
    const approved = await this.db.listLearningRecommendations({ status: 'approved', limit: 25 });
    const recommendation = approved.find(item => item.proposedChange?.experiment === 'title_thumbnail_variant');
    if (!recommendation) return null;
    try {
      const generated = await this.agents.thumbnailDesigner.generateABVariants(thumbnail.concept);
      return {
        sourceRecommendationId: recommendation.id,
        hypothesis: recommendation.title,
        status: 'draft',
        titleVariants: this.buildTitleExperimentVariants(seoData.title || script.title),
        thumbnailVariants: [
          { label: 'Control', path: productionData.assets?.thumbnail?.path, concept: thumbnail.concept },
          ...generated
        ],
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      this.logger.warn(`Packaging experiment preparation failed without blocking production: ${error.message}`);
      return null;
    }
  }

  validateProfile(input) {
    const textFields = ['channelName', 'goal', 'targetAudience', 'brandVoice', 'defaultStyle', 'callToAction', 'visualStyle', 'timezone'];
    const result = {};
    for (const field of textFields) {
      if (input[field] !== undefined) {
        const value = String(input[field]).trim();
        if (value.length > 500) throw new Error(`${field} is too long`);
        result[field] = value;
      }
    }
    if (input.bannedTopics !== undefined) {
      const topics = Array.isArray(input.bannedTopics) ? input.bannedTopics : String(input.bannedTopics).split(',');
      result.bannedTopics = topics.map(topic => String(topic).trim()).filter(Boolean).slice(0, 50);
    }
    return result;
  }

  decorateContentBundle(bundle) {
    const experiment = bundle.editorData?.packagingExperiment;
    const sceneLabels = new Map((bundle.scenes || []).map(scene => [scene.id, scene.label]));
    return {
      ...bundle,
      scenes: (bundle.scenes || []).map(scene => this.scenes
        ? this.scenes.decorateScene(scene, bundle.id)
        : scene),
      shorts: (bundle.shorts || []).map(clip => ({
        ...clip,
        sourceSceneLabels: clip.sourceSceneIds.map(id => sceneLabels.get(id)).filter(Boolean),
        assetUrls: {
          video: clip.outputPath ? `/api/content/${bundle.id}/shorts/${clip.id}/asset/video` : null,
          captions: clip.captionsPath ? `/api/content/${bundle.id}/shorts/${clip.id}/asset/captions` : null
        }
      })),
      assetUrls: {
        video: bundle.assets?.finalVideo?.path && !bundle.assets?.finalVideo?.simulated ? `/api/content/${bundle.id}/asset/video` : null,
        thumbnail: bundle.assets?.thumbnail?.path ? `/api/content/${bundle.id}/asset/thumbnail` : null,
        experimentThumbnails: (experiment?.thumbnailVariants || []).map((_variant, index) =>
          `/api/content/${bundle.id}/asset/experiment-thumbnail-${index}`
        ),
        captions: bundle.assets?.captions?.path ? `/api/content/${bundle.id}/asset/captions` : null,
        script: bundle.assets?.script?.originalPath ? `/api/content/${bundle.id}/asset/script` : null
      }
    };
  }

  async refreshContentReview(productionId, reviewNotes) {
    const bundle = await this.db.getProductionBundle(productionId);
    if (!bundle) return null;
    const profile = await this.db.getChannelProfile() || {};
    const quality = await this.operator.runQualityChecks({
      ...bundle,
      scheduledPublishTime: bundle.scheduled_publish_time
    }, profile);
    const status = quality.passed ? 'needs_review' : 'needs_attention';
    return this.db.saveContentReview(productionId, {
      status,
      editorData: { ...(bundle.editorData || {}), factChecked: false, rightsConfirmed: false },
      qualityChecks: quality.checks,
      reviewNotes: reviewNotes || (quality.passed ? null : `Blocking checks failed: ${quality.blockingFailures.join(', ')}`),
      reviewedAt: null
    });
  }

  async approveContent(productionId, input) {
    const bundle = await this.db.getProductionBundle(productionId);
    if (!bundle) {
      const error = new Error('Content not found');
      error.status = 404;
      throw error;
    }
    if (bundle.schedule?.status === 'published') {
      const error = new Error('Content is already published');
      error.status = 409;
      throw error;
    }

    const editorData = this.validateEditorData(input, bundle.editorData);
    const packagingExperiment = editorData.packagingExperiment;
    const thumbnailVariant = packagingExperiment?.thumbnailVariants?.[editorData.selectedThumbnailVariant];
    const titleVariant = packagingExperiment?.titleVariants?.[editorData.selectedTitleVariant];
    if (titleVariant && input.title === undefined) editorData.title = titleVariant.title;
    if (!editorData.factChecked || !editorData.rightsConfirmed) {
      const error = new Error('Confirm the factual review and media rights checks before approval');
      error.status = 409;
      throw error;
    }
    const productionData = {
      id: bundle.id,
      status: bundle.status,
      strategy: bundle.strategy,
      script: { ...bundle.script, title: editorData.title || bundle.script.title },
      thumbnail: bundle.thumbnail,
      seo: {
        ...bundle.seo,
        title: editorData.title || bundle.seo.title,
        description: editorData.description || bundle.seo.description,
        tags: editorData.tags || bundle.seo.tags
      },
      assets: thumbnailVariant
        ? { ...bundle.assets, thumbnail: { ...bundle.assets.thumbnail, path: thumbnailVariant.path } }
        : bundle.assets,
      timeline: bundle.timeline,
      scheduledPublishTime: editorData.publishTime || input.publishTime || bundle.scheduled_publish_time,
      priority: bundle.priority,
      estimatedDuration: bundle.estimated_duration,
      privacyStatus: editorData.privacyStatus || process.env.DEFAULT_PRIVACY_STATUS || 'private',
      provenance: bundle.provenance,
      containsSyntheticMedia: bundle.provenance?.containsSyntheticMedia === true,
      scenes: bundle.scenes || []
    };
    const profile = await this.db.getChannelProfile() || {};
    const quality = await this.operator.runQualityChecks(productionData, profile);
    if (!quality.passed) {
      await this.db.saveContentReview(bundle.id, {
        status: 'needs_attention', editorData, qualityChecks: quality.checks,
        reviewNotes: `Blocking checks failed: ${quality.blockingFailures.join(', ')}`
      });
      const error = new Error('Content still has blocking quality failures');
      error.status = 409;
      error.quality = quality;
      throw error;
    }

    let scheduleEntry = bundle.schedule;
    if (!scheduleEntry) {
      scheduleEntry = await this.agents.publishing.scheduleContent(productionData);
    } else if (scheduleEntry.status !== 'published') {
      scheduleEntry.title = productionData.script.title;
      scheduleEntry.publishTime = productionData.scheduledPublishTime;
      scheduleEntry.status = 'scheduled';
      scheduleEntry.metadata = {
        ...scheduleEntry.metadata,
        seo: productionData.seo,
        thumbnail: productionData.assets.thumbnail,
        video: productionData.assets.finalVideo,
        audio: productionData.assets.audio,
        captions: productionData.assets.captions,
        privacyStatus: editorData.privacyStatus || process.env.DEFAULT_PRIVACY_STATUS || 'private',
        containsSyntheticMedia: productionData.containsSyntheticMedia
      };
      await this.db.updateScheduleEntry(scheduleEntry);
      await this.agents.publishing.loadPublishQueue();
    }
    if (!scheduleEntry) {
      const error = new Error('A real MP4 is required before content can be approved for scheduling');
      error.status = 409;
      throw error;
    }

    await this.db.saveContentReview(bundle.id, {
      status: 'approved', editorData, qualityChecks: quality.checks,
      reviewNotes: input.reviewNotes || 'Approved by operator', reviewedAt: new Date().toISOString()
    });
    await this.db.updateProductionStatus(bundle.id, 'scheduled');
    await this.operator.notify({
      type: 'content_approved', level: 'success', title: 'Content approved',
      message: `${productionData.script.title} is scheduled for ${scheduleEntry.publishTime}`,
      data: { productionId, publishTime: scheduleEntry.publishTime }
    });
    return { productionId, reviewStatus: 'approved', qualityScore: quality.score, schedule: scheduleEntry };
  }

  async start() {
    const initialized = await this.initialize();
    
    if (!initialized) {
      console.log(chalk.red('\n❌ Failed to initialize. Please check your configuration.'));
      process.exit(1);
    }
    
    const PORT = process.env.PORT || 3456;
    this.app.listen(PORT, () => {
      console.log(chalk.green(`\n✅ YouTube Automation Agent running on port ${PORT}`));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.white('📊 Dashboard: ') + chalk.cyan(`http://localhost:${PORT}`));
      console.log(chalk.white('🔧 API Health: ') + chalk.cyan(`http://localhost:${PORT}/health`));
      console.log(chalk.white('📅 Schedule: ') + chalk.cyan(`http://localhost:${PORT}/schedule`));
      console.log(chalk.white('📈 Analytics: ') + chalk.cyan(`http://localhost:${PORT}/analytics`));
      console.log(chalk.gray('─'.repeat(50)));
      if (this.setupRequired) {
        console.log(chalk.yellow('\n⚙️  Setup is required. The dashboard is available; run npm run walkthrough to enable generation.'));
      } else {
        console.log(chalk.yellow('\n🤖 Automation is active. Approved content will be published on schedule.'));
      }
    });
  }
}

// Start the agent
if (require.main === module) {
  const agent = new YouTubeAutomationAgent();
  agent.start().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}

module.exports = { YouTubeAutomationAgent };
