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
    RoutingProfile: 'rp-sales',
    StaffingTarget: { min: 10, max: 25 },
    Channel: 'VOICE',
    Priority: 1,
    HoursOfOperation: 'BasicHours',
    OutboundCallerId: '+1234567890'
  },
  'support': {
    Id: 'queue-support-01',
    Name: 'Support Queue',
    Arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-support-01`,
    QueueType: 'STANDARD',
    RoutingProfile: 'rp-support',
    StaffingTarget: { min: 15, max: 30 },
    Channel: 'VOICE',
    Priority: 2,
    HoursOfOperation: 'ExtendedHours',
    OutboundCallerId: '+678912345'
  },
  'monitoring': {
    Id: 'queue-support-999',
    Name: 'Monitoring Queue',
    Arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-monitoring-01`,
    QueueType: 'AGENT',
    RoutingProfile: 'tf-support',
    StaffingTarget: { min: 5, max: 15 },
    Channel: 'VOICE',
    Priority: 2,
    HoursOfOperation: 'ExtendedHours',
    OutboundCallerId: '+987654321'
  },
  'monitoring_chat': {
    Id: 'queue-chat-999',
    Name: 'Monitoring Chat Queue',
    Arn: `arn:aws:connect:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}/queue/queue-monitoring-chat-01`,
    QueueType: 'AGENT',
    RoutingProfile: 'tf-support',
    StaffingTarget: { min: 20, max: 70 },
    Channel: 'CHAT',
    Priority: 2,
    HoursOfOperation: 'ExtendedHours',
    OutboundCallerId: '+987654321'
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
      const { min, max } = queue.StaffingTarget;
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
  console.log('\nValidating metrics:', JSON.stringify(metrics, null, 2));
  
  if (!Array.isArray(metrics)) {
    console.log('Metrics is not an array');
    return false;
  }
  
  const validationResults = metrics.every(metric => {
    console.log('Checking metric:', JSON.stringify(metric));
    const isValid = metric && 
      typeof metric.Name === 'string' && 
      VALID_METRICS[metric.Name] !== undefined;
    console.log('Metric validation result:', isValid);
    return isValid;
  });
  
  console.log('Valid metrics:', validationResults);
  return validationResults;
}

function validateFilters(filters) {
  if (!Array.isArray(filters)) {
    console.log('Filters is not an array');
    return false;
  }
  return filters.every(filter => {
    console.log('\nValidating filter:', JSON.stringify(filter, null, 2));
    
    // Check if Queues array exists and is not empty
    if (!filter.Queues || !Array.isArray(filter.Queues) || filter.Queues.length === 0) {
      console.log('Invalid or empty Queues array');
      return false;
    }
    
    // Check if all queue ARNs exist
    console.log('\nAvailable queue ARNs:', JSON.stringify(Object.values(MOCK_QUEUES).map(q => q.Arn), null, 2));
    
    const validQueues = filter.Queues.every(queueArn => {
      const found = Object.values(MOCK_QUEUES).some(q => {
        const arnsMatch = q.Arn === queueArn;
        console.log('\nARN Comparison (Character by character):');
        console.log('Request ARN :', queueArn);
        console.log('Queue ARN  :', q.Arn);
        console.log('Lengths   :', queueArn.length, q.Arn.length);
        console.log('Match     :', arnsMatch);
        if (!arnsMatch) {
          // Find the first difference
          for (let i = 0; i < Math.max(queueArn.length, q.Arn.length); i++) {
            if (queueArn[i] !== q.Arn[i]) {
              console.log(`First difference at position ${i}:`);
              console.log(`Request: "${queueArn[i]}" (${queueArn.charCodeAt(i)})`);
              console.log(`Queue  : "${q.Arn[i]}" (${q.Arn.charCodeAt(i)})`);
              break;
            }
          }
        }
        return arnsMatch;
      });
      
      if (!found) {
        console.log('Queue not found for ARN:', queueArn);
      }
      return found;
    });
    
    if (!validQueues) {
      console.log('Queue validation failed');
      return false;
    }

    // Check channel if specified
    if (filter.Channel && !VALID_CHANNELS.includes(filter.Channel)) {
      console.log('Channel validation failed:', filter.Channel);
      return false;
    }

    console.log('Filter validation passed');
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
            Arn: this.queue.Arn,
            Name: this.queue.Name
          },
          Channel: this.queue.Channel,
          QueueType: this.queue.QueueType
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
  console.log('\n=== GetCurrentMetricData Request ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  const error = shouldError();
  if (error) {
    console.log('Random error triggered:', error);
    return res.status(500).json(error);
  }

  try {
    const { InstanceId, Filters, Metrics, NextToken } = req.body;
    console.log('\nValidation Steps:');

    // Validate required parameters
    if (!InstanceId || !Filters || !Filters[0].Metrics) {
      console.log('Step 1: Missing required parameters');
      console.log('InstanceId:', !!InstanceId);
      console.log('Filters:', !!Filters);
      console.log('Metrics:', !!Filters?.[0]?.Metrics);
      return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
    }

    // Validate instance ID
    if (InstanceId !== INSTANCE_ID) {
      console.log('Step 2: Instance ID mismatch');
      console.log('Received:', InstanceId);
      console.log('Expected:', INSTANCE_ID);
      return res.status(404).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
    }

    console.log('Step 3: Processing Filters');
    console.log(JSON.stringify(Filters, null, 2));
    
    // Validate filters and metrics
    const filtersValid = validateFilters(Filters);
    console.log('Step 4: Filters validation result:', filtersValid);
    
    if (!filtersValid) {
      return res.status(400).json({
        __type: 'ResourceNotFoundException',
        message: 'One or more queues specified in the request cannot be found'
      });
    }

    const metricsValid = validateMetrics(Filters[0].Metrics);
    console.log('Step 5: Metrics validation result:', metricsValid);
    
    if (!metricsValid) {
      return res.status(400).json(AWS_ERRORS.VALIDATION_EXCEPTION);
    }

    const allMetricResults = [];
    
    Filters.forEach(filter => {
      const queueArns = filter.Queues || [];
      console.log('\nProcessing filter:', JSON.stringify(filter, null, 2));
      
      queueArns.forEach(queueArn => {
        console.log('\nLooking for queue:', queueArn);
        const queue = Object.values(MOCK_QUEUES).find(q => q.Arn === queueArn);
        console.log('Queue found:', queue ? 'Yes' : 'No');
        
        if (queue) {
          console.log('Queue details:', JSON.stringify(queue, null, 2));
          if (!filter.Channel || filter.Channel === queue.Channel) {
            console.log('Channel match successful');
            const generator = new MetricGenerator(queue);
            const metrics = generator.generateMetrics(filter.Metrics.map(m => m.Name));
            console.log('Generated metrics:', JSON.stringify(metrics, null, 2));
            allMetricResults.push(...metrics);
          } else {
            console.log('Channel mismatch:', filter.Channel, '!==', queue.Channel);
          }
        }
      });
    });

    const { items, nextToken } = paginateResults(allMetricResults, NextToken);
    console.log('\nFinal response:', JSON.stringify({
      MetricResults: items,
      NextToken: nextToken,
      DataSnapshotTime: new Date().toISOString()
    }, null, 2));

    res.json({
      MetricResults: items,
      NextToken: nextToken,
      DataSnapshotTime: new Date().toISOString()
    });

  } catch (error) {
    console.error('Internal error:', error);
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
