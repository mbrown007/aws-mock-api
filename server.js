const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

// Constants for ARN generation
const INSTANCE_ID = 'f604177c-b2ab-4c76-9033-635d195b2772';
const ACCOUNT_ID = '123456789012';
const REGION = 'us-east-1';

// Mock Queues Configuration
const MOCK_QUEUES = {
  'sales': {
    queueId: 'queue-sales-01',
    name: 'Sales Queue',
    arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-sales-01`,
    routingProfile: 'rp-sales',
    staffingTarget: { min: 10, max: 25 }  // Target staffing levels
  },
  'support': {
    queueId: 'queue-support-01',
    name: 'Support Queue',
    arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-support-01`,
    routingProfile: 'rp-support',
    staffingTarget: { min: 15, max: 30 }
  },
  // Add more queues here with their specific configurations
};

// Metric Generation Configuration
const MetricGenerators = {
  // Base metrics that other metrics might depend on
  baseMetrics: {
    CONTACTS_IN_QUEUE: (queue, baseValues) => ({
      value: Math.floor(Math.random() * 8) + 1,
      unit: 'COUNT'
    }),
    
    AGENTS_STAFFED: (queue, baseValues) => {
      const { min, max } = queue.staffingTarget;
      return {
        value: Math.floor(Math.random() * (max - min)) + min,
        unit: 'COUNT'
      };
    }
  },

  // Derived metrics that depend on base metrics
  derivedMetrics: {
    OLDEST_CONTACT_AGE: (queue, baseValues) => ({
      value: baseValues.CONTACTS_IN_QUEUE.value * (Math.floor(Math.random() * 20) + 10), // 10-30 seconds per contact in queue
      unit: 'SECONDS'
    }),

    AGENTS_ON_CALL: (queue, baseValues) => {
      const maxAgentsForCalls = Math.floor(baseValues.AGENTS_STAFFED.value * 0.7);
      const minAgentsNeeded = Math.min(baseValues.CONTACTS_IN_QUEUE.value, maxAgentsForCalls);
      return {
        value: Math.max(minAgentsNeeded, Math.floor(maxAgentsForCalls * 0.6)),
        unit: 'COUNT'
      };
    },

    AGENTS_AVAILABLE: (queue, baseValues) => {
      const busyAgents = baseValues.AGENTS_ON_CALL.value;
      const acwAgents = Math.floor(baseValues.AGENTS_ON_CALL.value * 0.2);
      const otherStates = Math.floor(baseValues.AGENTS_STAFFED.value * 0.2);
      const availableAgents = Math.max(0, baseValues.AGENTS_STAFFED.value - busyAgents - acwAgents - otherStates);
      return {
        value: availableAgents,
        unit: 'COUNT'
      };
    },

    AGENTS_AFTER_CONTACT_WORK: (queue, baseValues) => ({
      value: Math.max(1, Math.floor(baseValues.AGENTS_ON_CALL.value * 0.2)), // 20% of agents on call
      unit: 'COUNT'
    }),

    CONTACTS_SCHEDULED: (queue, baseValues) => ({
      value: Math.floor(Math.random() * 5) + 1,
      unit: 'COUNT'
    }),

    // Add new metrics here following the same pattern
  }
};

class MetricGenerator {
  constructor(queue) {
    this.queue = queue;
    this.baseValues = {};
    this.derivedValues = {};
  }

  generateMetrics(requestedMetrics) {
    // Generate base metrics first
    Object.keys(MetricGenerators.baseMetrics).forEach(metricName => {
      this.baseValues[metricName] = MetricGenerators.baseMetrics[metricName](this.queue, this.baseValues);
    });

    // Generate derived metrics
    Object.keys(MetricGenerators.derivedMetrics).forEach(metricName => {
      this.derivedValues[metricName] = MetricGenerators.derivedMetrics[metricName](this.queue, {
        ...this.baseValues,
        ...this.derivedValues
      });
    });

    // Return only requested metrics
    return requestedMetrics.map(metricName => {
      const metricValue = this.baseValues[metricName] || this.derivedValues[metricName] || {
        value: 0,
        unit: 'COUNT'
      };

      return {
        Dimensions: [{
          Name: "Queue",
          Value: this.queue.name
        }, {
          Name: "QueueId",
          Value: this.queue.queueId
        }, {
          Name: "InstanceId",
          Value: INSTANCE_ID
        }],
        Collections: [{
          Metric: {
            Name: metricName,
            Unit: metricValue.unit
          },
          Value: metricValue.value
        }]
      };
    });
  }
}

// AWS Connect GetCurrentMetricsData endpoint
app.post('/GetCurrentMetricsData', (req, res) => {
  try {
    const { Filters, MaxResults } = req.body;

    if (!Filters || !Array.isArray(Filters)) {
      return res.status(400).json({
        __type: 'ValidationException',
        message: 'Filters must be provided as an array'
      });
    }

    const metricResults = [];

    Filters.forEach(filter => {
      if (filter.Channel === 'VOICE') {
        // For each queue in the filter
        filter.Queues.forEach(queueArn => {
          // Find the queue configuration
          const queueConfig = Object.values(MOCK_QUEUES).find(q => q.arn === queueArn);
          if (queueConfig) {
            const generator = new MetricGenerator(queueConfig);
            metricResults.push(...generator.generateMetrics(filter.Metrics));
          }
        });
      }
    });

    res.json({
      MetricResults: metricResults,
      NextToken: null,
      DataSnapshotTime: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      __type: 'InternalServiceError',
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mock AWS Connect API running on port ${PORT}`);
});
