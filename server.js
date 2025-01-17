const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

// Constants for ARN generation
const INSTANCE_ID = 'f604177c-b2ab-4c76-9033-635d195b2772';
const ACCOUNT_ID = '123456789012';
const REGION = 'eu-west-2';

// Error simulation controls
let errorRate = 0.2;
let currentErrors = 0;
let maxConsecutiveErrors = 2;

// Pagination configuration
const ITEMS_PER_PAGE = 2;

// Valid metrics and their units
const VALID_METRICS = {
  CONTACTS_IN_QUEUE: 'COUNT',
  OLDEST_CONTACT_AGE: 'SECONDS',
  AGENTS_ON_CALL: 'COUNT',
  AGENTS_AVAILABLE: 'COUNT',
  AGENTS_STAFFED: 'COUNT',
  AGENTS_AFTER_CONTACT_WORK: 'COUNT',
  CONTACTS_SCHEDULED: 'COUNT'
};

// Valid channels
const VALID_CHANNELS = ['VOICE', 'CHAT', 'TASK'];

// AWS Error Types
const AWS_ERRORS = {
  THROTTLING: {
    __type: 'ThrottlingException',
    message: 'Rate exceeded'
  },
  SERVICE_UNAVAILABLE: {
    __type: 'ServiceUnavailableException',
    message: 'Service is unavailable'
  },
  INTERNAL_SERVICE_ERROR: {
    __type: 'InternalServiceErrorException',
    message: 'Internal server error occurred'
  },
  RESOURCE_NOT_FOUND: {
    __type: 'ResourceNotFoundException',
    message: 'The specified resource was not found'
  },
  INVALID_PARAMETER: {
    __type: 'InvalidParameterException',
    message: 'One or more parameters are not valid'
  },
  VALIDATION_EXCEPTION: {
    __type: 'ValidationException',
    message: 'Validation error occurred'
  }
};

// Rich Queue Configuration
const MOCK_QUEUES = {
  'sales': {
    Id: 'queue-sales-01',
    Name: 'Sales Queue',
    Arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-sales-01`,
    QueueType: 'STANDARD',
    routingProfile: 'rp-sales',
    staffingTarget: { min: 10, max: 25 },
    channel: 'VOICE',
    priority: 1,
    hoursOfOperation: 'BasicHours',
    outboundCallerId: '+1234567890'
  },
  'support': {
    Id: 'queue-support-01',
    Name: 'Support Queue',
    Arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-support-01`,
    QueueType: 'STANDARD',
    routingProfile: 'rp-support',
    staffingTarget: { min: 15, max: 30 },
    channel: 'VOICE',
    priority: 2,
    hoursOfOperation: 'ExtendedHours',
    outboundCallerId: '+678912345'
  },
  'monitoring': {
    Id: 'queue-support-999',
    Name: 'Monitoring Queue',
    Arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-monitoring-01`,
    QueueType: 'AGENT',
    routingProfile: 'tf-support',
    staffingTarget: { min: 5, max: 15 },
    channel: 'VOICE',
    priority: 2,
    hoursOfOperation: 'ExtendedHours',
    outboundCallerId: '+987654321'
  },
  'monitoring_chat': {
    Id: 'queue-chat-999',
    Name: 'Monitoring Chat Queue',
    Arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-monitoring-chat-01`,
    QueueType: 'AGENT',
    routingProfile: 'tf-support',
    staffingTarget: { min: 20, max: 70 },
    channel: 'CHAT',
    priority: 2,
    hoursOfOperation: 'ExtendedHours',
    outboundCallerId: '+987654321'
  }
};

// Sophisticated Metric Generation
const MetricGenerators = {
  baseMetrics: {
    CONTACTS_IN_QUEUE: (queue, baseValues) => ({
      value: Math.floor(Math.random() * 8) + 1,
      unit: VALID_METRICS.CONTACTS_IN_QUEUE
    }),
    AGENTS_STAFFED: (queue, baseValues) => {
      const { min, max } = queue.staffingTarget;
      return {
        value: Math.floor(Math.random() * (max - min)) + min,
        unit: VALID_METRICS.AGENTS_STAFFED
      };
    }
  },
  derivedMetrics: {
    OLDEST_CONTACT_AGE: (queue, baseValues) => ({
      value: baseValues.CONTACTS_IN_QUEUE.value * (Math.floor(Math.random() * 20) + 10),
      unit: VALID_METRICS.OLDEST_CONTACT_AGE
    }),
    AGENTS_ON_CALL: (queue, baseValues) => {
      const maxAgentsForCalls = Math.floor(baseValues.AGENTS_STAFFED.value * 0.7);
      const minAgentsNeeded = Math.min(baseValues.CONTACTS_IN_QUEUE.value, maxAgentsForCalls);
      return {
        value: Math.max(minAgentsNeeded, Math.floor(maxAgentsForCalls * 0.6)),
        unit: VALID_METRICS.AGENTS_ON_CALL
      };
    },
    AGENTS_AVAILABLE: (queue, baseValues) => {
      const busyAgents = baseValues.AGENTS_ON_CALL.value;
      const acwAgents = Math.floor(baseValues.AGENTS_ON_CALL.value * 0.2);
      const otherStates = Math.floor(baseValues.AGENTS_STAFFED.value * 0.2);
      const availableAgents = Math.max(0, baseValues.AGENTS_STAFFED.value - busyAgents - acwAgents - otherStates);
      return {
        value: availableAgents,
        unit: VALID_METRICS.AGENTS_AVAILABLE
      };
    },
    AGENTS_AFTER_CONTACT_WORK: (queue, baseValues) => ({
      value: Math.max(1, Math.floor(baseValues.AGENTS_ON_CALL.value * 0.2)),
      unit: VALID_METRICS.AGENTS_AFTER_CONTACT_WORK
    }),
    CONTACTS_SCHEDULED: (queue, baseValues) => ({
      value: Math.floor(Math.random() * 5) + 1,
      unit: VALID_METRICS.CONTACTS_SCHEDULED
    })
  }
};

function validateMetrics(metrics) {
  if (!Array.isArray(metrics)) {
    return false;
  }
  return metrics.every(metric => 
    metric && 
    typeof metric.Name === 'string' && 
    VALID_METRICS[metric.Name] !== undefined
  );
}

function validateFilters(filters) {
  if (!Array.isArray(filters)) {
    return false;
  }
  return filters.every(filter => {
    if (!filter.Queues || !Array.isArray(filter.Queues)) {
      return false;
    }
    if (filter.Channel && !VALID_CHANNELS.includes(filter.Channel)) {
      return false;
    }
    return true;
  });
}

// Error Handling Functions
function shouldError() {
  if (Math.random() < errorRate) {
    currentErrors++;
    if (currentErrors <= maxConsecutiveErrors) {
      const errors = Object.values(AWS_ERRORS);
      return errors[Math.floor(Math.random() * errors.length)];
    }
  }
  currentErrors = 0;
  return null;
}

function paginateResults(items, nextToken) {
  const startIndex = nextToken ? parseInt(nextToken) : 0;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const hasMore = endIndex < items.length;
  
  return {
    items: items.slice(startIndex, endIndex),
    nextToken: hasMore ? endIndex.toString() : null
  };
}

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

    // Return requested metrics in AWS SDK format
    return requestedMetrics.map(metricName => {
      const metricValue = this.baseValues[metricName] || this.derivedValues[metricName] || {
        value: 0,
        unit: VALID_METRICS[metricName] || 'COUNT'
      };

      return {
        Dimensions: {
          Queue: {
            Id: this.queue.Id,
            Arn: this.queue.Arn
          },
          Channel: this.queue.channel
        },
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

// ListQueues endpoint with pagination and error simulation
app.get('/ListQueues', (req, res) => {
  const error = shouldError();
  if (error) {
    return res.status(500).json(error);
  }

  const instanceId = req.query.InstanceId;
  if (!instanceId) {
    return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
  }

  if (instanceId !== INSTANCE_ID) {
    return res.status(404).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
  }

  const queueList = Object.values(MOCK_QUEUES);
  const { items, nextToken } = paginateResults(queueList, req.query.NextToken);

  res.json({
    QueueSummaryList: items,
    NextToken: nextToken
  });
});

// GetCurrentMetricData endpoint with error simulation and pagination
app.post('/GetCurrentMetricData', (req, res) => {
  const error = shouldError();
  if (error) {
    return res.status(500).json(error);
  }

  try {
    const { InstanceId, Filters, CurrentMetrics, NextToken } = req.body;

    // Validate required parameters
    if (!InstanceId || !Filters || !CurrentMetrics) {
      return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
    }

    // Validate instance ID
    if (InstanceId !== INSTANCE_ID) {
      return res.status(404).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
    }

    // Validate filters and metrics
    if (!validateFilters(Filters)) {
      return res.status(400).json(AWS_ERRORS.VALIDATION_EXCEPTION);
    }

    if (!validateMetrics(CurrentMetrics)) {
      return res.status(400).json(AWS_ERRORS.VALIDATION_EXCEPTION);
    }

    const allMetricResults = [];
    
    Filters.forEach(filter => {
      const queueArns = filter.Queues || [];
      queueArns.forEach(queueArn => {
        const queue = Object.values(MOCK_QUEUES).find(q => q.Arn === queueArn);
        if (queue && (!filter.Channel || filter.Channel === queue.channel)) {
          const generator = new MetricGenerator(queue);
          allMetricResults.push(...generator.generateMetrics(CurrentMetrics.map(m => m.Name)));
        }
      });
    });

    const { items, nextToken } = paginateResults(allMetricResults, NextToken);

    res.json({
      MetricResults: items,
      NextToken: nextToken,
      DataSnapshotTime: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json(AWS_ERRORS.INTERNAL_SERVICE_ERROR);
  }
});

// Error rate control endpoint
app.post('/admin/errorRate', (req, res) => {
  if (typeof req.body.rate === 'number') {
    errorRate = Math.max(0, Math.min(1, req.body.rate));
    res.json({ message: `Error rate set to ${errorRate * 100}%` });
  } else {
    res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mock AWS Connect API running on port ${PORT}`);
});
