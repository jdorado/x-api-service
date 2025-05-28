import express from 'express';
import cors from 'cors';
import { TwitterHelper } from './twitter_helper.js';
import { SearchMode } from 'agent-twitter-client';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import swaggerJsDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { loadSecrets } from './keychain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

export const SECRETS_CONFIG = [
    ['general', 'MONGO_CONNECTION'],
];

// Load secrets from iCloud Keychain if enabled
if (process.env.USE_KEYCHAIN === 'true') {
    try {
        console.log('🔐 Loading secrets from iCloud Keychain...');
        const secretsLoaded = await loadSecrets(SECRETS_CONFIG);
        if (secretsLoaded) {
            console.log('✅ All secrets loaded successfully from iCloud Keychain');
        } else {
            console.warn('⚠️  Some secrets could not be loaded from iCloud Keychain');
        }
    } catch (error) {
        console.error('❌ Error loading secrets from iCloud Keychain:', error.message);
        console.log('Continuing with environment variables from .env file...');
    }
} else {
    console.log('📄 Using environment variables from .env file (USE_KEYCHAIN not set to true)');
}

const app = express();
const port = process.env.PORT || 6011;

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Twitter API Service',
            version: '1.0.0',
            description: 'REST API wrapper for Twitter API',
            contact: {
                name: 'API Support'
            },
            servers: [
                {
                    url: `http://localhost:${port}`
                }
            ]
        },
        components: {
            schemas: {
                Credentials: {
                    type: 'object',
                    required: ['username', 'password'],
                    properties: {
                        username: {
                            type: 'string',
                            description: 'Twitter username'
                        },
                        password: {
                            type: 'string',
                            description: 'Twitter password'
                        }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message'
                        }
                    }
                }
            }
        }
    },
    apis: ['./src/index.js']
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Simple request logging middleware
app.use((req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
    });

    next();
});

app.use(cors());
app.use(express.json());

const twitterHelper = new TwitterHelper();

// Middleware to validate credentials
const validateCredentials = (req, res, next) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({
            error: 'Username and password are required'
        });
    }
    next();
};

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns a health status of the API
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 */
app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: Login to Twitter
 *     description: Login with Twitter credentials and retrieve profile information
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Credentials'
 *     responses:
 *       200:
 *         description: Login successful, returns profile information
 *       401:
 *         description: Authentication failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/login', validateCredentials, async (req, res) => {
    try {
        const profile = await twitterHelper.getProfile(req.body);
        res.json(profile);
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/profile/{user}:
 *   post:
 *     summary: Get a user's profile
 *     description: Retrieve profile information for a specific user
 *     parameters:
 *       - in: path
 *         name: user
 *         required: true
 *         schema:
 *           type: string
 *         description: Twitter username to get profile for
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Credentials'
 *     responses:
 *       200:
 *         description: Successfully retrieved profile
 *       500:
 *         description: Error retrieving profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/profile/:user', validateCredentials, async (req, res) => {
    try {
        const profile = await twitterHelper.getTargetProfile(
            req.body,
            req.params.user
        );
        res.json(profile);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/tweets/{userId}:
 *   post:
 *     summary: Get user tweets
 *     description: Retrieve tweets from a specific user
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: Twitter user ID or username
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Credentials'
 *               - type: object
 *                 properties:
 *                   count:
 *                     type: integer
 *                     description: Number of tweets to retrieve
 *                     default: 10
 *     responses:
 *       200:
 *         description: Successfully retrieved tweets
 *       500:
 *         description: Error retrieving tweets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/tweets/:userId', validateCredentials, async (req, res) => {
    try {
        const { count = 10 } = req.body;
        const tweets = await twitterHelper.getUserTweets(
            req.body,
            req.params.userId,
            count
        );
        res.json(tweets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/timeline:
 *   post:
 *     summary: Get home timeline
 *     description: Retrieve tweets from the home timeline
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Credentials'
 *               - type: object
 *                 properties:
 *                   count:
 *                     type: integer
 *                     description: Number of tweets to retrieve
 *                     default: 10
 *                   following:
 *                     type: boolean
 *                     description: Get tweets from following only
 *                     default: false
 *     responses:
 *       200:
 *         description: Successfully retrieved timeline
 *       500:
 *         description: Error retrieving timeline
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/timeline', validateCredentials, async (req, res) => {
    try {
        const { count = 10, following = false } = req.body;
        const tweets = await twitterHelper.fetchHomeTimeline(
            req.body,
            count,
            following
        );
        res.json(tweets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/search:
 *   post:
 *     summary: Search tweets
 *     description: Search for tweets with a query
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Credentials'
 *               - type: object
 *                 required:
 *                   - query
 *                 properties:
 *                   query:
 *                     type: string
 *                     description: Search query
 *                   maxTweets:
 *                     type: integer
 *                     description: Maximum number of tweets to retrieve
 *                     default: 10
 *                   mode:
 *                     type: string
 *                     description: Search mode
 *                     enum: [Latest, Top, Photos, Videos]
 *                     default: Latest
 *                   cursor:
 *                     type: string
 *                     description: Cursor for pagination
 *     responses:
 *       200:
 *         description: Successfully retrieved search results
 *       400:
 *         description: Missing query parameter
 *       500:
 *         description: Error searching tweets
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/search', validateCredentials, async (req, res) => {
    try {
        const {
            query,
            maxTweets = 10,
            mode = 'Latest',
            cursor
        } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Query parameter is required'
            });
        }

        const tweets = await twitterHelper.searchTweets(
            req.body,
            query,
            maxTweets,
            SearchMode[mode],
            cursor
        );
        res.json(tweets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/tweet:
 *   post:
 *     summary: Post a tweet
 *     description: Create a new tweet, retweet, or quote tweet
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Credentials'
 *               - type: object
 *                 properties:
 *                   text:
 *                     type: string
 *                     description: The tweet text
 *                   quote_tweet_id:
 *                     type: string
 *                     description: ID of the tweet to quote
 *     responses:
 *       200:
 *         description: Successfully posted tweet
 *       400:
 *         description: Missing required parameters
 *       500:
 *         description: Error posting tweet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/tweet', validateCredentials, async (req, res) => {
    try {
        const { text, quote_tweet_id} = req.body;
        if (!text && !quote_tweet_id) {
            return res.status(400).json({
                error: 'Text is required'
            });
        }
        const tweet = await twitterHelper.sendTweet(req.body);
        res.json(tweet);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/tweet/poll:
 *   post:
 *     summary: Post a tweet with poll
 *     description: Create a new tweet with a poll
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Credentials'
 *               - type: object
 *                 required:
 *                   - text
 *                   - options
 *                 properties:
 *                   text:
 *                     type: string
 *                     description: The tweet text
 *                   options:
 *                     type: array
 *                     description: Poll options (2-4 options)
 *                     items:
 *                       type: string
 *                   durationMinutes:
 *                     type: integer
 *                     description: Poll duration in minutes
 *                     default: 120
 *     responses:
 *       200:
 *         description: Successfully posted tweet with poll
 *       400:
 *         description: Missing required parameters or invalid poll options
 *       500:
 *         description: Error posting tweet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/tweet/poll', validateCredentials, async (req, res) => {
    try {
        const { text, options, durationMinutes = 120 } = req.body;
        if (!text || !options || !Array.isArray(options)) {
            return res.status(400).json({
                error: 'Text and options array are required'
            });
        }
        if (options.length < 2 || options.length > 4) {
            return res.status(400).json({
                error: 'Poll must have between 2 and 4 options'
            });
        }

        const tweet = await twitterHelper.sendTweetWithPoll(
            req.body,
            text,
            options,
            durationMinutes
        );
        res.json(tweet);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/tweet/{id}:
 *   post:
 *     summary: Get a specific tweet
 *     description: Retrieve a specific tweet by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the tweet to retrieve
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Credentials'
 *     responses:
 *       200:
 *         description: Successfully retrieved tweet
 *       500:
 *         description: Error retrieving tweet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/tweet/:id', validateCredentials, async (req, res) => {
    try {
        const tweet = await twitterHelper.getTweet(req.body, req.params.id);
        res.json(tweet);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/following/{userId}:
 *   post:
 *     summary: Get users followed by a specific user
 *     description: Retrieve a list of users that a specific user is following
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the user whose following list to retrieve
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/Credentials'
 *               - type: object
 *                 properties:
 *                   count:
 *                     type: integer
 *                     description: Number of following users to retrieve
 *                     default: 100
 *     responses:
 *       200:
 *         description: Successfully retrieved following list
 *       500:
 *         description: Error retrieving following list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/following/:userId', validateCredentials, async (req, res) => {
    try {
        const { count = 100 } = req.body;
        const following = await twitterHelper.getFollowing(
            req.body,
            req.params.userId,
            count
        );
        res.json(following);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`API Documentation available at http://localhost:${port}/docs`);
});