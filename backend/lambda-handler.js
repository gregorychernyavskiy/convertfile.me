const serverlessExpress = require('@vendia/serverless-express');
const app = require('./server');

// Create serverless express handler
const handler = serverlessExpress({ app });

module.exports.handler = async (event, context) => {
    // Log the incoming event for debugging
    console.log('Received event:', JSON.stringify(event, null, 2));
    
    try {
        const result = await handler(event, context);
        console.log('Handler result:', JSON.stringify(result, null, 2));
        return result;
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};
