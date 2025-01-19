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
 *
 * set random error rate 10%:
 * curl -X POST http://localhost:3000/admin/errorRate \ -H 'Content-Type: application/json' \ -d '{"rate": 0.1}'

 ****************************************************/

const express = require('express');     // Express framework for routing and HTTP handling
const bodyParser = require('body-parser');  // Middleware for parsing incoming request bodies

const app = express();

// Parse JSON bodies for POST requests
app.use(bodyParser.json());

// Add CORS headers for local testing
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

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
class MetricGenerator {
  constructor(queue) {
    this.queue = queue;
    this.baseValues = {};
  }

  generateMetrics(metricNames) {
    // First generate base metrics
    for (const name of metricNames) {
      if (MetricGenerators.baseMetrics[name]) {
        this.baseValues[name] = MetricGenerators.baseMetrics[name](this.queue, this.baseValues);
      }
    }

    // Then generate derived metrics
    const results = [];
    for (const name of metricNames) {
      let metricValue;
      if (MetricGenerators.baseMetrics[name]) {
        metricValue = this.baseValues[name];
      } else if (MetricGenerators.derivedMetrics[name]) {
        metricValue = MetricGenerators.derivedMetrics[name](this.queue, this.baseValues);
      }

      if (metricValue) {
        results.push({
          Dimensions: {
            Queue: {
              Arn: this.queue.Arn,
              Id: this.queue.Id,
              Name: this.queue.Name
            },
            Channel: this.queue.Channel
          },
          Collections: [{
            Metric: {
              Name: name,
              Unit: metricValue.unit
            },
            Value: metricValue.value
          }]
        });
      }
    }

    return results;
  }
}

// Metric generators for different metric types
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

/**
 * validateFilters(filters)
 * Ensures that each filter has a valid array of queue ARNs
 * and optionally a valid channel if specified.
 * 
 * @param {Array} filters - Array of filter objects
 * @return {boolean} true if valid, false otherwise
 */
function validateFilters(filters) {
    console.log('\n=== Starting Filter Validation ===');
    console.log('Validating filters:', JSON.stringify(filters, null, 2));

    // 1. Basic structure validation
    if (!filters || typeof filters !== 'object') {
        console.log('❌ Invalid filters object - not an object:', typeof filters);
        return false;
    }

    // 2. Validate Queues array
    if (!Array.isArray(filters.Queues) || filters.Queues.length === 0) {
        console.log('❌ Invalid or empty Queues array:', filters.Queues);
        return false;
    }

    console.log('\n📋 Available Queues:');
    Object.values(MOCK_QUEUES).forEach(q => {
        console.log(`  - ID: ${q.Id}, Name: ${q.Name}`);
    });

    // 3. Validate each Queue ID
    const validQueues = filters.Queues.every(queueId => {
        console.log(`\n🔍 Validating Queue ID: ${queueId}`);
        
        const queue = Object.values(MOCK_QUEUES).find(q => q.Id === queueId);
        const found = !!queue;

        if (found) {
            console.log('✅ Found matching queue:', {
                Id: queue.Id,
                Name: queue.Name,
                Type: queue.QueueType,
                Channel: queue.Channel
            });
        } else {
            console.log('❌ No matching queue found for ID:', queueId);
            console.log('Available Queue IDs:', Object.values(MOCK_QUEUES).map(q => q.Id));
        }

        return found;
    });

    // 4. Channel validation (if specified)
    if (filters.Channel) {
        console.log('\n📡 Validating Channel:', filters.Channel);
        if (!VALID_CHANNELS.includes(filters.Channel)) {
            console.log('❌ Invalid channel. Valid channels are:', VALID_CHANNELS);
            return false;
        }
        console.log('✅ Channel validation passed');
    }

    // 5. Final result
    console.log('\n=== Filter Validation Result ===');
    console.log(validQueues ? '✅ All validations passed' : '❌ Validation failed');
    
    return validQueues;
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
// Update the paginateResults function
function paginateResults(items, nextToken) {
    // Parse nextToken as number, default to 0
    const startIndex = nextToken ? parseInt(nextToken) : 0;
    
    // Debug pagination
    console.log(`Pagination request: items.length=${items.length}, nextToken=${nextToken}, startIndex=${startIndex}`);
    
    // If startIndex is beyond array length, return empty result
    if (startIndex >= items.length) {
        console.log('Pagination: startIndex beyond array length, returning empty result');
        return {
            items: [],
            nextToken: null
        };
    }
    
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, items.length);
    const hasMore = endIndex < items.length;

    console.log(`Pagination: startIndex=${startIndex}, endIndex=${endIndex}, hasMore=${hasMore}`);
    
    return {
        items: items.slice(startIndex, endIndex),
        nextToken: hasMore ? endIndex.toString() : null
    };
}

/****************************************************
 * MAIN ROUTE HANDLER
 ****************************************************/
app.all('*', (req, res, next) => {
    console.log('\n=== Incoming Request ===');
    console.log('Method:', req.method);
    console.log('Path:', req.path);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Query:', JSON.stringify(req.query, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const action = req.headers['x-amz-target'];
    console.log('Action:', action);

    // Check if this is an AWS SDK style request
    if (action === 'ListQueues' || req.path.includes('/queues-summary/')) {
        // Extract instanceId from either query or path
        let instanceId;
        if (req.path.includes('/queues-summary/')) {
            instanceId = req.path.split('/queues-summary/')[1]?.split('?')[0];
            console.log('Extracted instanceId from path:', instanceId);
        } else {
            instanceId = req.query.InstanceId;
            console.log('Using instanceId from query:', instanceId);
        }
        
        // Validate instanceId
        if (!instanceId) {
            console.log('Missing instanceId');
            return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
        }

        if (instanceId !== INSTANCE_ID) {
            console.log('Instance ID mismatch:', instanceId, '!==', INSTANCE_ID);
            return res.status(404).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
        }

        // Validate nextToken if provided
        const nextToken = req.query.nextToken;
        if (nextToken && isNaN(parseInt(nextToken))) {
            console.log('Invalid nextToken:', nextToken);
            return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
        }

        // Simulate random errors
        const error = shouldError();
        if (error) {
            console.log('Random error triggered:', error);
            return res.status(500).json(error);
        }

        // Get queue list and paginate
        const queueList = Object.values(MOCK_QUEUES);
        const { items, nextToken: newNextToken } = paginateResults(queueList, nextToken);

        console.log('Returning queues:', items);
        console.log('Next token:', newNextToken);
        
        return res.json({
            QueueSummaryList: items,
            NextToken: newNextToken
        });
    } 
    else if (action === 'GetCurrentMetricData' || req.path.includes('/metrics/current/')) {
        console.log('\n=== Processing Metrics Request ===');
        
        // 1. Extract and validate instanceId
        let instanceId;
        if (req.path.includes('/metrics/current/')) {
            instanceId = req.path.split('/metrics/current/')[1]?.split('?')[0];
            console.log('📍 Extracted instanceId from path:', instanceId);
        } else {
            instanceId = req.body.InstanceId;
            console.log('📍 Using instanceId from body:', instanceId);
        }

        if (!instanceId || instanceId !== INSTANCE_ID) {
            console.log('❌ Invalid instanceId:', instanceId);
            console.log('Expected:', INSTANCE_ID);
            return res.status(404).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
        }

        try {
            const body = req.body;
            console.log('\n📦 Request body:', JSON.stringify(body, null, 2));
            
            // 2. Validate request structure
            if (!body.Filters || !body.CurrentMetrics) {
                console.log('❌ Missing required fields. Filters or CurrentMetrics not found');
                return res.status(400).json(AWS_ERRORS.INVALID_PARAMETER);
            }

            // 3. Validate metrics
            console.log('\n🔍 Validating metrics...');
            const metricsValid = validateMetrics(body.CurrentMetrics);
            if (!metricsValid) {
                console.log('❌ Metric validation failed');
                return res.status(400).json(AWS_ERRORS.VALIDATION_EXCEPTION);
            }
            console.log('✅ Metrics validation passed');

            // 4. Validate filters
            console.log('\n🔍 Validating filters...');
            const filtersValid = validateFilters(body.Filters);
            if (!filtersValid) {
                console.log('❌ Filter validation failed');
                return res.status(400).json(AWS_ERRORS.RESOURCE_NOT_FOUND);
            }
            console.log('✅ Filters validation passed');

            // 5. Check for random errors
            const error = shouldError();
            if (error) {
                console.log('⚠️ Random error triggered:', error);
                return res.status(500).json(error);
            }

            // 6. Generate metrics
            console.log('\n📊 Generating metrics...');
            const allMetricResults = [];
            const queueIds = body.Filters.Queues;
            
            queueIds.forEach(queueId => {
                const queue = Object.values(MOCK_QUEUES).find(q => q.Id === queueId);
                if (queue) {
                    console.log(`Generating metrics for queue: ${queue.Name} (${queue.Id})`);
                    const generator = new MetricGenerator(queue);
                    const metrics = generator.generateMetrics(
                        body.CurrentMetrics.map(m => m.Name)
                    );
                    console.log('Generated metrics:', JSON.stringify(metrics, null, 2));
                    allMetricResults.push(...metrics);
                }
            });

            // 7. Paginate results
            console.log('\n📑 Paginating results...');
            const { items, nextToken: newNextToken } = paginateResults(
                allMetricResults, 
                body.NextToken
            );

            // 8. Send response
            const response = {
                MetricResults: items,
                NextToken: newNextToken,
                DataSnapshotTime: Date.now()
            };

            console.log('\n✅ Sending response:', JSON.stringify(response, null, 2));
            return res.json(response);

        } catch (error) {
            console.error('\n❌ Internal error:', error);
            return res.status(500).json(AWS_ERRORS.INTERNAL_SERVICE_ERROR);
        }
    }
    
    // If not an AWS SDK request, continue to other routes
    next();
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

//OPTIONS handler for CORS preflight requests
app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', '*');
    res.sendStatus(200);
});

// Handle unmatched routes
app.use((req, res) => {
    console.log('Unmatched route:', req.path);
    res.status(404).json({
        __type: 'UnknownOperationException',
        message: `Unknown operation: ${req.path}`
    });
});

/****************************************************
 * SERVER START
 ****************************************************/

// Start the Express server on port 3000 or a custom port if set in the environment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mock AWS Connect API running on port ${PORT}`);
  console.log(`Instance ID: ${INSTANCE_ID}`);
  console.log(`Error rate: ${errorRate * 100}%`);
});
