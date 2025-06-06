import { Scraper } from 'agent-twitter-client';
import { MongoClient } from 'mongodb';

export class TwitterClient {
    static instances = {};
    static cookies = {};  // In-memory cookies storage

    constructor() {
        this.mongoUri = process.env.MONGO_CONNECTION;
        this.dbName = 'x-api';
        this.collectionName = 'cookies';
        this.mongoClient = null;
    }

    // Initialize MongoDB connection
    async initMongoClient() {
        if (!this.mongoClient) {
            this.mongoClient = new MongoClient(this.mongoUri, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });
        }

        if (!this.mongoClient.topology || !this.mongoClient.topology.isConnected()) {
            try {
                await this.mongoClient.connect();
            } catch (error) {
                console.error('Failed to connect to MongoDB:', error.message);
                throw error;
            }
        }
        return this.mongoClient;
    }

    async getClient(credentials) {
        const { username, password, email, twoFactorSecret, cookies } = credentials;
        let lastError = null;

        try {
            // Try to use existing client if already logged in
            if (await this.tryExistingClient(username)) {
                return TwitterClient.instances[username];
            }

            const client = new Scraper();

            // Try cookies in the following order:
            // 1. Passed cookies (if provided)
            if (cookies && await this.tryPassedCookies(client, username, cookies)) {
                return this.saveClientAndReturn(username, client);
            }

            // 2. In-memory cookies
            if (await this.tryInMemoryCookies(client, username)) {
                return this.saveClientAndReturn(username, client);
            }

            // 3. MongoDB cookies
            if (await this.tryMongoCookies(client, username)) {
                return this.saveClientAndReturn(username, client);
            }

            // 4. Fresh login
            try {
                if (await this.tryFreshLogin(client, username, password, email, twoFactorSecret)) {
                    return this.saveClientAndReturn(username, client);
                }
            } catch (loginError) {
                lastError = loginError;
            }

            // Extract meaningful error message
            let errorMessage = 'All authentication methods failed';
            if (lastError?.message) {
                try {
                    // Try to parse if it's a JSON error response
                    const errorObj = JSON.parse(lastError.message);
                    if (errorObj.errors && errorObj.errors.length > 0) {
                        errorMessage = errorObj.errors[0].message;
                    } else {
                        errorMessage = lastError.message;
                    }
                } catch {
                    // If not JSON, use the message as is
                    errorMessage = lastError.message;
                }
            }
            throw new Error(`Failed to authenticate: ${errorMessage}`);
        } catch (error) {
            console.error('Error in getClient:', error.message);
            throw error;
        }
    }

    async tryExistingClient(username) {
        if (TwitterClient.instances[username]) {
            const client = TwitterClient.instances[username];
            try {
                if (await client.isLoggedIn()) {
                    return true;
                }
            } catch (error) {
                console.error('Error checking existing client login status:', error.message);
            }
        }
        return false;
    }

    async tryPassedCookies(client, username, cookies) {
        try {
            await this.setCookiesOnClient(client, cookies);
            if (await client.isLoggedIn()) {
                // Save the successful cookies to both in-memory and MongoDB
                await this.saveCookies(username, cookies);
                TwitterClient.cookies[username] = cookies; // Cache in memory
                return true;
            }
        } catch (error) {
            console.error('Failed to use passed cookies:', error.message);
        }
        return false;
    }

    async tryInMemoryCookies(client, username) {
        const cookies = TwitterClient.cookies[username];
        if (cookies) {
            try {
                await this.setCookiesOnClient(client, cookies);
                if (await client.isLoggedIn()) {
                    return true;
                }
            } catch (error) {
                console.error('Failed to use in-memory cookies:', error.message);
            }
        }
        return false;
    }

    async tryMongoCookies(client, username) {
        let mongoClient = null;
        try {
            mongoClient = await this.initMongoClient();
            const db = mongoClient.db(this.dbName);
            const collection = db.collection(this.collectionName);

            const document = await collection.findOne({ _id: username });
            if (document?.cookies) {
                await this.setCookiesOnClient(client, document.cookies);
                if (await client.isLoggedIn()) {
                    TwitterClient.cookies[username] = document.cookies; // Cache in memory
                    return true;
                }
            }
        } catch (error) {
            console.error('Failed to use MongoDB cookies:', error.message);
        }
        return false;
    }

    async tryFreshLogin(client, username, password, email, twoFactorSecret) {
        try {
            await client.login(username, password, email, twoFactorSecret);
            if (await client.isLoggedIn()) {
                const newCookies = await client.getCookies();
                await this.saveCookies(username, newCookies);
                TwitterClient.cookies[username] = newCookies; // Cache in memory
                return true;
            }
            return false;
        } catch (error) {
            console.error('Failed to login:', error.message);
            throw error; // Propagate the actual error instead of returning false
        }
    }

    async saveCookies(username, cookies) {
        let mongoClient = null;
        try {
            mongoClient = await this.initMongoClient();
            const db = mongoClient.db(this.dbName);
            const collection = db.collection(this.collectionName);

            await collection.updateOne(
                { _id: username },
                { $set: { cookies, updatedAt: new Date() } },
                { upsert: true }
            );
        } catch (error) {
            console.error(`Failed to save cookies: ${error.message}`);
            throw error;
        }
    }

    async setCookiesOnClient(client, cookies) {
        const cookieStrings = cookies.map(cookie => {
            // Transform all x.com domains to twitter.com for compatibility with agent-twitter-client
            let domain = cookie.domain;
            if (domain && domain.includes('x.com')) {
                // Normalize all x.com variations to .twitter.com (works across all subdomains)
                domain = '.twitter.com';
            }
            
            return `${cookie.key}=${cookie.value}; Domain=${domain}; Path=${cookie.path}${cookie.secure ? '; Secure' : ''}${cookie.httpOnly ? '; HttpOnly' : ''}; SameSite=${cookie.sameSite || 'Lax'}`;
        });
        await client.setCookies(cookieStrings);
    }

    saveClientAndReturn(username, client) {
        TwitterClient.instances[username] = client;
        return client;
    }

    async getCachedData(key, type, cacheDurationMs = 43200000) { // default 12 hours
        try {
            const mongoClient = await this.initMongoClient();
            const db = mongoClient.db(this.dbName);
            const collection = db.collection('twitter_cache');
            
            const cacheEntry = await collection.findOne({ _id: `${type}_${key}` });
            
            if (!cacheEntry) return null;
            
            // Check if cache is still valid using passed duration
            const cacheAge = Date.now() - cacheEntry.timestamp;
            if (cacheAge > cacheDurationMs) return null;
            
            return cacheEntry.data;
        } catch (error) {
            console.error('Error getting cached data:', error.message);
            return null;
        }
    }

    async setCachedData(key, type, data, cacheDurationMs = 43200000) { // default 12 hours
        try {
            const mongoClient = await this.initMongoClient();
            const db = mongoClient.db(this.dbName);
            const collection = db.collection('twitter_cache');
            
            await collection.updateOne(
                { _id: `${type}_${key}` },
                {
                    $set: {
                        data,
                        timestamp: Date.now(),
                        expiresAt: Date.now() + cacheDurationMs
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            console.error('Error setting cached data:', error.message);
        }
    }
}