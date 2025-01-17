/****************************************************
 * MOCK AWS CONNECT API
 * 
 * This file simulates a subset of AWS Connect's 
 * functionality for testing or demonstration purposes.
 * 
 * It provides endpoints that mimic:
 *   - ListQueues
 *   - GetCurrentMetricData
 *   - Error rate control (admin)
 *   
 * It uses in-memory data and randomized metrics, 
 * allowing you to experiment with how an AWS Connect 
 * client might interact with a real AWS Connect service.
 ****************************************************/

const express = require('express');     // Express framework for routing and HTTP handling
const bodyParser = require('body-parser');  // Middleware for parsing incoming request bodies

const app = express();

// Parse JSON bodies for POST requests
app.use(bodyParser.json());

/****************************************************
 * CONSTANTS AND CONFIGURATION
 ****************************************************/

// Mock AWS Connect instance and account details
const INSTANCE_ID = 'f604177c-b2ab-4c76-9033-635d195b2772';  // A mock instance ID
const ACCOUNT_ID = '123456789012';                          // Typical AWS account ID format
const REGION = 'eu-west-2';                                 // Example AWS region

// Error simulation controls
let errorRate = 0.2;            // The probability (0.0 - 1.0) that an error will occur
let currentErrors = 0;          // Counter for consecutive errors
let maxConsecutiveErrors = 2;   // Max consecutive errors to allow before resetting

// Pagination configuration
const ITEMS_PER_PAGE = 2;       // Number of items returned per page

// Valid metrics and their default units (for AWS Connect-like behavior)
const VALID_METRICS = {
  CONTACTS_IN_QUEUE: 'COUNT',
  OLDEST_CONTACT_AGE: 'SECONDS',
  AGENTS_ON_CALL: 'COUNT',
  AGENTS_AVAILABLE: 'COUNT',
  AGENTS_STAFFED: 'COUNT',
  AGENTS_AFTER_CONTACT_WORK: 'COUNT',
  CONTACTS_SCHEDULED: 'COUNT'
};

// Valid channels that this mock service recognizes
const VALID_CHANNELS = ['VOICE', 'CHAT', 'TASK'];

/****************************************************
 * AWS-LIKE ERRORS
 ****************************************************/
// Mock error objects that simulate the structure of
// various AWS service exceptions.
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

/****************************************************
 * MOCK QUEUES
 * 
 * This object simulates various queue configurations
 * as if they were in an AWS Connect instance.
 ****************************************************/
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

/****************************************************
 * SOPHISTICATED METRIC GENERATION
 * 
 * We separate metrics into baseMetrics and 
 * derivedMetrics for clarity and reusability.
 ****************************************************/

// Base metric generators compute fundamental values
const MetricGenerators = {
  baseMetrics: {
    CONTACTS_IN_QUEUE: (queue, baseValues) => ({
      // Random number between 1 and 8
      value: Math.floor(Math.random() * 8) + 1,
      unit: VALID_METRICS.CONTACTS_IN_QUEUE
    }),
    AGENTS_STAFFED: (queue, baseValues) => {
      // Agents staffed is a random number between queue.StaffingTarget.min and max
      const { min, max } = queue.StaffingTarget;
      return {
        value: Math.floor(Math.random() * (max - min)) + min,
        unit: VALID_METRICS.AGENTS_STAFFED
      };
    }
  },
  
  // Derived metric generators use base metrics to calculate further values
  derivedMetrics: {
    OLDEST_CONTACT_AGE: (queue, baseValues) => ({
      // OLDEST_CONTACT_AGE is proportional to the number of CONTACTS_IN_QUEUE
      value: baseValues.CONTACTS_IN_QUEUE.value * (Math.floor(Math.random() * 20) + 10),
      unit: VALID_METRICS.OLDEST_CONTACT_AGE
    }),
    AGENTS_ON_CALL: (queue, baseValues) => {
      // AGENTS_ON_CALL is some fraction of AGENTS_STAFFED, 
      // but at least as many as we have contacts in queue
      const maxAgentsForCalls = Math.floor(baseValues.AGENTS_STAFFED.value * 0.7);
      const minAgentsNeeded = Math.min(baseValues.CONTACTS_IN_QUEUE.value, maxAgentsForCalls);
      return {
        value: Math.max(minAgentsNeeded, Math.floor(maxAgentsForCalls * 0.6)),
        unit: VALID_METRICS.AGENTS_ON_CALL
      };
    },
    AGENTS_AVAILABLE: (queue, baseValues) => {
      // AGENTS_AVAILABLE = AGENTS_STAFFED - busyAgents - acwAgents - otherStates
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
      // AGENTS_AFTER_CONTACT_WORK is set to 20% of AGENTS_ON_CALL
      value: Math.max(1, Math.floor(baseValues.AGENTS_ON_CALL.value * 0.2)),
      unit: VALID_METRICS.AGENTS_AFTER_CONTACT_WORK
    }),
    CONTACTS_SCHEDULED: (queue, baseValues) => ({
      // Random number of scheduled contacts between 1 and 5
      value: Math.floor(Math.random() * 5) + 1,
      unit: VALID_METRICS.CONTACTS_SCHEDULED
    })
  }
};

/****************************************************
 * VALIDATION FUNCTIONS
 ****************************************************/

/**
 * validateMetrics(metrics)
 * Checks if metrics is an array and that each metric 
 * matches one of the valid metric names in VALID_METRICS.
 * 
 * @param {Array} metrics - Array of metric definitions
 * @return {boolean} true if valid, false otherwise
 */
function validateMetrics(metrics) {
  console.log('\nValidating metrics:', JSON.stringify(metrics, null, 2));
  
  // Check if metrics is an array
  if (!Array.isArray(metrics)) {
    console.log('Metrics is not an array');
    return false;
  }
  
  // Every metric must have a valid name
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

/**
 * validateFilters(filters)
 * Ensures that each filter has a valid array of queue ARNs
 * and optionally a valid channel if specified.
 * 
 * @param {Array} filters - Array of filter objects
 * @return {boolean} true if valid, false otherwise
 */
function validateFilters(filters) {
  if (!Array.isArray(filters)) {
    console.log('Filters is not an array');
    return false;
  }
  
  // Check each filter one by one
  return filters.every(filter => {
    console.log('\nValidating filter:', JSON.stringify(filter, null, 2));
    
    // 1. Queues must be present and non-empty
    if (!filter.Queues || !Array.isArray(filter.Queues) || filter.Queues.length === 0) {
      console.log('Invalid or empty Queues array');
      return false;
    }
    
    // 2. Each queue ARN in the filter must match an ARN from MOCK_QUEUES
    console.log('\nAvailable queue ARNs:', JSON.stringify(Object.values(MOCK_QUEUES).map(q => q.Arn), null, 2));
    const validQueues = filter.Queues.every(queueArn => {
      const found = Object.values(MOCK_QUEUES).some(q => {
        const arnsMatch = q.Arn === queueArn;
        console.log('\nARN Comparison (Character by character):');
        console.log('Request ARN :', queueArn);
        console.log('Queue ARN  :', q.Arn);
        console.log('Lengths   :', queueArn.length, q.Arn.length);
        console.log('Match     :', arnsMatch);
        
        // If they don't match, log the first difference for debug purposes
        if (!arnsMatch) {
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

    // 3. Check channel if specified, must be in VALID_CHANNELS
    if (filter.Channel && !VALID_CHANNELS.includes(filter.Channel)) {
      console.log('Channel validation failed:', filter.Channel);
      return false;
    }

    console.log('Filter validation passed');
    return true;
  });
}

/****************************************************
 * ERROR HANDLING/ SIMULATION FUNCTIONS
 ****************************************************/

/**
 * shouldError()
 * Randomly decides if an error should be triggered 
 * based on errorRate and maxConsecutiveErrors.
 * 
 * @return {Object|null} - AWS-like error object or null
 */
function shouldError() {
  // Use the errorRate to decide if we should trigger an error
  if (Math.random() < errorRate) {
    currentErrors++;
    if (currentErrors <= maxConsecutiveErrors) {
      // Randomly select an error from AWS_ERRORS
      const errors = Object.values(AWS_ERRORS);
      return errors[Math.floor(Math.random() * errors.length)];
    }
  }
  // Reset consecutive error counter if we didn't error this time
  currentErrors = 0;
  return null;
}

/****************************************************
 * PAGINATION HELPER
 ****************************************************/

/**
 * paginateResults(items, nextToken)
 * Splits the items into pages of ITEMS_PER_PAGE each.
 * If nextToken is provided, pagination begins from 
 * that index.
 * 
 * @param {Array} items - The full array of items
 * @param {string} nextToken - The current pagination token
 * @return {Object} { items, nextToken }
 */
function paginateResults(items, nextToken) {
  // nextToken is the starting index
  const startIndex = nextToken ? parseInt(nextToken) : 0;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const hasMore = endIndex < items.length;
  
  return {
    items: items.slice(startIndex, endIndex),
    nextToken: hasMore ? endIndex.toString() : null
  };
}

/****************************************************
 * METRIC GENERATOR CLASS
 ****************************************************/
/**
 * Class to handle the generation of metrics for a 
 * single queue. It first calculates base metric 
 * values, then derives further metric values, and 
 * returns them in a format similar to the 
 * GetCurrentMetricData AWS response.
 */
class MetricGenerator {
  constructor(queue) {
    // The queue for which we generate metrics
    this.queue = queue;
    // Store base values (CONTACTS_IN_QUEUE, etc.)
    this.baseValues = {};
    // Store derived values (AGENTS_AVAILABLE, etc.)
    this.derivedValues = {};
  }

  /**
   * generateMetrics(requestedMetrics)
   * 
   * @param {Array<string>} requestedMetrics - Array of metric names to generate
   * @returns {Array<Object>} - Array of metric result objects
   */
  generateMetrics(requestedMetrics) {
    // 1. Generate base metrics first
    Object.keys(MetricGenerators.baseMetrics).forEach(metricName => {
      this.baseValues[metricName] = MetricGenerators.baseMetrics[metricName](this.queue, this.baseValues);
    });

    // 2. Generate derived metrics using both baseValues & derivedValues so far
    Object.keys(MetricGenerators.derivedMetrics).forEach(metricName => {
      this.derivedValues[metricName] = MetricGenerators.derivedMetrics[metricName](this.queue, {
        ...this.baseValues,
        ...this.derivedValues
      });
    });

    // 3. Return requested metrics in AWS SDK-like format
    return requestedMetrics.map(metricName => {
      // Try to find the metric in baseValues or derivedValues; if not found, default to zero
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

/****************************************************
 * ENDPOINTS
 ****************************************************/

/**
 * GET /ListQueues
 * 
 * Returns a paginated list of mock queues in the 
 * style of AWS Connect's ListQueues API.
 * 
 * Query Parameters:
 *    InstanceId (required) - must match INSTANCE_ID
 *    NextToken (optional) - indicates pagination start
 */
app.get('/ListQueues', (req, res) => {
  // Simulate random errors
  const error = shouldError();
  if (error) {
    return res.status(500).json(error);
  }

  // Validate InstanceId
  const instanceId = req.query.InstanceId;
  if (!instanceId) {
    return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
  }

  if (instanceId !== INSTANCE_ID) {
    return res.status(404).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
  }

  // Paginate the mock queue list
  const queueList = Object.values(MOCK_QUEUES);
  const { items, nextToken } = paginateResults(queueList, req.query.NextToken);

  // Return queues in an AWS-like JSON structure
  res.json({
    QueueSummaryList: items,
    NextToken: nextToken
  });
});

/**
 * POST /GetCurrentMetricData
 * 
 * Mocks the AWS Connect API GetCurrentMetricData endpoint.
 * It validates incoming parameters and filters, 
 * optionally triggers random errors, and returns 
 * paginated metric results for requested queues.
 */
app.post('/GetCurrentMetricData', (req, res) => {
  console.log('\n=== GetCurrentMetricData Request ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));

  // Possibly trigger a random error
  const error = shouldError();
  if (error) {
    console.log('Random error triggered:', error);
    return res.status(500).json(error);
  }

  try {
    // Destructure required fields from the request body
    const { InstanceId, Filters, Metrics, NextToken } = req.body;
    console.log('\nValidation Steps:');

    // 1. Validate required parameters
    if (!InstanceId || !Filters || !Filters[0]?.Metrics) {
      console.log('Step 1: Missing required parameters');
      console.log('InstanceId:', !!InstanceId);
      console.log('Filters:', !!Filters);
      console.log('Metrics in Filter[0]:', !!Filters?.[0]?.Metrics);
      return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
    }

    // 2. Validate instance ID
    if (InstanceId !== INSTANCE_ID) {
      console.log('Step 2: Instance ID mismatch');
      console.log('Received:', InstanceId);
      console.log('Expected:', INSTANCE_ID);
      return res.status(404).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
    }

    console.log('Step 3: Processing Filters');
    console.log(JSON.stringify(Filters, null, 2));
    
    // 3. Validate filters
    const filtersValid = validateFilters(Filters);
    console.log('Step 4: Filters validation result:', filtersValid);
    
    if (!filtersValid) {
      return res.status(400).json({
        __type: 'ResourceNotFoundException',
        message: 'One or more queues specified in the request cannot be found'
      });
    }

    // 4. Validate metrics
    const metricsValid = validateMetrics(Filters[0].Metrics);
    console.log('Step 5: Metrics validation result:', metricsValid);
    
    if (!metricsValid) {
      return res.status(400).json(AWS_ERRORS.VALIDATION_EXCEPTION);
    }

    /****************************************************
     * GENERATE THE REQUESTED METRIC DATA
     ****************************************************/
    const allMetricResults = [];
    
    // Iterate through each filter
    Filters.forEach(filter => {
      const queueArns = filter.Queues || [];
      console.log('\nProcessing filter:', JSON.stringify(filter, null, 2));
      
      // For each ARN in the filter, find the matching mock queue and generate metrics
      queueArns.forEach(queueArn => {
        console.log('\nLooking for queue:', queueArn);
        const queue = Object.values(MOCK_QUEUES).find(q => q.Arn === queueArn);
        console.log('Queue found:', queue ? 'Yes' : 'No');
        
        if (queue) {
          console.log('Queue details:', JSON.stringify(queue, null, 2));
          // If there's no channel specified or the channel matches the queue's channel, generate metrics
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

    // 5. Paginate results and return response
    const { items, nextToken: newNextToken } = paginateResults(allMetricResults, NextToken);
    console.log('\nFinal response:', JSON.stringify({
      MetricResults: items,
      NextToken: newNextToken,
      DataSnapshotTime: new Date().toISOString()
    }, null, 2));

    // Construct the final response object in an AWS-like fashion
    res.json({
      MetricResults: items,
      NextToken: newNextToken,
      DataSnapshotTime: new Date().toISOString()
    });

  } catch (error) {
    // Catch any unexpected runtime errors in the logic
    console.error('Internal error:', error);
    res.status(500).json(AWS_ERRORS.INTERNAL_SERVICE_ERROR);
  }
});

/**
 * POST /admin/errorRate
 * 
 * Allows an admin (or a developer) to set a new error rate 
 * at runtime. Must be a number between 0 and 1, inclusive.
 * Example body: { "rate": 0.5 }
 */
app.post('/admin/errorRate', (req, res) => {
  // Check if the "rate" field is a valid number
  if (typeof req.body.rate === 'number') {
    // Clamp the value between 0 and 1
    errorRate = Math.max(0, Math.min(1, req.body.rate));
    res.json({ message: `Error rate set to ${errorRate * 100}%` });
  } else {
    // If it's not a valid number, respond with an INVALID_PARAMETER error
    res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
  }
});

/****************************************************
 * SERVER START
 ****************************************************/

// Start the Express server on port 3000 or a custom port if set in the environment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mock AWS Connect API running on port ${PORT}`);
});
