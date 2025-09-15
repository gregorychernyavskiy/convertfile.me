const { MongoClient } = require('mongodb');

let client;
let db;
let isConnecting = false;

// MongoDB connection with better error handling and connection pooling
async function connectToDatabase() {
    // Prevent multiple simultaneous connections
    if (isConnecting) {
        // Wait for existing connection attempt
        while (isConnecting) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return db;
    }

    // Reuse existing connection if available (for local development)
    if (client && db && process.env.NODE_ENV !== 'production') {
        try {
            await db.admin().ping();
            return db;
        } catch (error) {
            console.log('Existing connection failed, creating new one');
            client = null;
            db = null;
        }
    }

    isConnecting = true;
    
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            console.warn('MONGODB_URI not found in environment variables. Database features will be disabled.');
            return null;
        }
        
        // Optimized connection settings for both local and serverless
        const connectionOptions = {
            serverSelectionTimeoutMS: process.env.NODE_ENV === 'production' ? 5000 : 10000,
            connectTimeoutMS: process.env.NODE_ENV === 'production' ? 5000 : 10000,
            socketTimeoutMS: 45000,
            maxPoolSize: process.env.NODE_ENV === 'production' ? 1 : 10,
            minPoolSize: 0,
            retryWrites: true,
            w: 'majority',
            readPreference: 'primary',
            appName: 'ConvertFileMe'
        };
        
        // Create new client
        const newClient = new MongoClient(uri, connectionOptions);
        
        await newClient.connect();
        const newDb = newClient.db('convertfile');
        
        // Test the connection
        await newDb.admin().ping();
        console.log(`Connected to MongoDB successfully (${process.env.NODE_ENV || 'development'} mode)`);
        
        // Store globally for reuse
        client = newClient;
        db = newDb;
        
        return newDb;
    } catch (error) {
        console.error('MongoDB connection error:', error.message);
        // In production, log more details for debugging
        if (process.env.NODE_ENV === 'production') {
            console.error('Connection details:', {
                hasUri: !!process.env.MONGODB_URI,
                uriPrefix: process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 20) + '...' : 'none'
            });
        }
        return null;
    } finally {
        isConnecting = false;
    }
}

// Get stats collection with error handling
async function getStatsCollection() {
    try {
        const database = await connectToDatabase();
        if (!database) {
            throw new Error('Database not available');
        }
        return database.collection('stats');
    } catch (error) {
        console.error('Error getting stats collection:', error.message);
        throw error;
    }
}

// Load stats from database
async function loadStats() {
    try {
        const collection = await getStatsCollection();
        let stats = await collection.findOne({ _id: 'global' });
        
        if (!stats) {
            // Create initial stats document
            stats = {
                _id: 'global',
                totalVisits: 0,
                totalConversions: 0,
                totalCombines: 0,
                totalPdfToWord: 0,
                totalPdfToImages: 0,
                dailyStats: {},
                lastUpdated: new Date().toISOString()
            };
            await collection.insertOne(stats);
        }
        
        return stats;
    } catch (error) {
        console.error('Error loading stats from database:', error);
        // Return default stats if database is unavailable
        return {
            totalVisits: 0,
            totalConversions: 0,
            totalCombines: 0,
            totalPdfToWord: 0,
            totalPdfToImages: 0,
            dailyStats: {},
            lastUpdated: new Date().toISOString()
        };
    }
}

// Save stats to database
async function saveStats(stats) {
    try {
        const collection = await getStatsCollection();
        stats.lastUpdated = new Date().toISOString();
        
        await collection.replaceOne(
            { _id: 'global' },
            { ...stats, _id: 'global' },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error saving stats to database:', error);
    }
}

// Get today's date string
function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

// Track event
async function trackEvent(eventType) {
    try {
        const database = await connectToDatabase();
        if (!database) {
            console.log(`Event tracking skipped (no database): ${eventType}`);
            return null;
        }
        
        const stats = await loadStats();
        const today = getTodayString();
        
        // Initialize daily stats if needed
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = {
                visits: 0,
                conversions: 0,
                combines: 0,
                pdfToWord: 0,
                pdfToImages: 0
            };
        }
        
        // Increment counters
        switch (eventType) {
            case 'visit':
                stats.totalVisits++;
                stats.dailyStats[today].visits++;
                break;
            case 'conversion':
                stats.totalConversions++;
                stats.dailyStats[today].conversions++;
                break;
            case 'combine':
                stats.totalCombines++;
                stats.dailyStats[today].combines++;
                break;
            case 'pdfToWord':
                stats.totalPdfToWord++;
                stats.dailyStats[today].pdfToWord++;
                break;
            case 'pdfToImages':
                stats.totalPdfToImages++;
                stats.dailyStats[today].pdfToImages++;
                break;
        }
        
        // Clean up old daily stats (keep only last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        Object.keys(stats.dailyStats).forEach(date => {
            if (new Date(date) < thirtyDaysAgo) {
                delete stats.dailyStats[date];
            }
        });
        
        await saveStats(stats);
        console.log(`Event tracked: ${eventType}`);
        return stats;
    } catch (error) {
        console.error('Error tracking event:', error.message);
        return null;
    }
}

// Get user activity collection
async function getUserActivityCollection() {
    const database = await connectToDatabase();
    if (!database) {
        throw new Error('Database not available');
    }
    return database.collection('user_activity');
}

// Log detailed user activity
async function logUserActivity(activityData) {
    try {
        const database = await connectToDatabase();
        if (!database) {
            console.log(`User activity logging skipped (no database): ${activityData.action}`);
            return null;
        }
        
        const collection = await getUserActivityCollection();
        
        const activityLog = {
            ...activityData,
            timestamp: new Date(),
            date: getTodayString(),
            _id: undefined // Let MongoDB generate the ID
        };
        
        await collection.insertOne(activityLog);
        console.log(`User activity logged: ${activityData.action} by ${activityData.ip}`);
        return activityLog;
    } catch (error) {
        console.error('Error logging user activity:', error.message);
        return null;
    }
}

// Get user activity stats
async function getUserActivityStats(days = 7) {
    try {
        const collection = await getUserActivityCollection();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        const pipeline = [
            {
                $match: {
                    timestamp: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        action: '$action',
                        date: '$date'
                    },
                    count: { $sum: 1 },
                    uniqueIPs: { $addToSet: '$ip' },
                    totalFileSize: { $sum: { $ifNull: ['$fileSize', 0] } }
                }
            },
            {
                $group: {
                    _id: '$_id.action',
                    totalCount: { $sum: '$count' },
                    dailyBreakdown: {
                        $push: {
                            date: '$_id.date',
                            count: '$count',
                            uniqueIPs: { $size: '$uniqueIPs' },
                            totalFileSize: '$totalFileSize'
                        }
                    }
                }
            }
        ];
        
        const stats = await collection.aggregate(pipeline).toArray();
        return stats;
    } catch (error) {
        console.error('Error getting user activity stats:', error);
        return [];
    }
}

// Get recent user activities
async function getRecentUserActivities(limit = 100) {
    try {
        const collection = await getUserActivityCollection();
        const activities = await collection
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        
        return activities;
    } catch (error) {
        console.error('Error getting recent user activities:', error);
        return [];
    }
}

// Helper function to extract client info from request
function extractClientInfo(req) {
    const ip = req.headers['x-forwarded-for'] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               '127.0.0.1';

    const userAgent = req.headers['user-agent'] || 'Unknown';
    const referer = req.headers['referer'] || req.headers['referrer'] || null;
    
    return {
        ip: Array.isArray(ip) ? ip[0] : ip.split(',')[0].trim(),
        userAgent,
        referer,
        method: req.method,
        url: req.url,
        headers: {
            'accept-language': req.headers['accept-language'],
            'accept-encoding': req.headers['accept-encoding']
        }
    };
}

// Close database connection
async function closeDatabase() {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}

module.exports = {
    connectToDatabase,
    loadStats,
    saveStats,
    trackEvent,
    closeDatabase,
    logUserActivity,
    getUserActivityStats,
    getRecentUserActivities,
    extractClientInfo
};
