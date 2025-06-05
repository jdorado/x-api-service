import { TwitterClient } from './client.js';

export class TwitterHelper {
    static profiles = {};
    static THIRTY_MINUTES_MS = 30 * 60 * 1000;

    constructor() {
        this.client = new TwitterClient();
    }

    async getProfile(credentials) {
        try {
            // Check in-memory cache first
            if (TwitterHelper.profiles[credentials.username]) {
                return TwitterHelper.profiles[credentials.username];
            }

            // Check MongoDB cache
            const cachedProfile = await this.client.getCachedData(credentials.username, 'profile');
            if (cachedProfile) {
                TwitterHelper.profiles[credentials.username] = cachedProfile;
                return cachedProfile;
            }

            const client = await this.client.getClient(credentials);
            const userProfile = await client.getProfile(credentials.username);
            const profile = {
                id: userProfile.userId,
                username: credentials.username,
                screenName: userProfile.name || credentials.username,
                bio: userProfile.biography || '',
                cookies: await client.getCookies()
            };

            TwitterHelper.profiles[credentials.username] = profile;
            await this.client.setCachedData(credentials.username, 'profile', profile);
            return profile;
        } catch (error) {
            console.error('Error getting profile:', error.message);
            return { status: 500, error: `Failed to fetch profile: ${error.message}` };
        }
    }

    async getTargetProfile(credentials, targetUsername) {
        try {
            // Check MongoDB cache
            const cachedProfile = await this.client.getCachedData(targetUsername, 'target_profile');
            if (cachedProfile) {
                return cachedProfile;
            }

            const client = await this.client.getClient(credentials);
            const userProfile = await client.getProfile(targetUsername.replace('@', ''));

            const profile = {
                id: userProfile.userId,
                username: targetUsername,
                screenName: userProfile.name || targetUsername,
                bio: userProfile.biography || '',
                followersCount: userProfile.followersCount,
                followingCount: userProfile.followingCount,
                tweetsCount: userProfile.tweetsCount,
                isVerified: userProfile.isVerified,
                isPrivate: userProfile.isPrivate,
                joined: userProfile.joined,
                location: userProfile.location || '',
                website: userProfile.website || ''
            };

            // Cache the profile
            await this.client.setCachedData(targetUsername, 'target_profile', profile);
            return profile;
        } catch (error) {
            console.error('Error getting target profile:', error.message);
            return { status: 500, error: `Failed to fetch target profile: ${error.message}` };
        }
    }

    async getTweet(credentials, tweetId) {
        try {
            const client = await this.client.getClient(credentials);
            const tweet = await client.getTweet(tweetId);
            
            // Remove circular references using JSON.parse/stringify
            return JSON.parse(JSON.stringify(tweet, (key, value) => {
                // Skip circular reference properties that cause issues
                if (key === 'inReplyToStatus' || key === 'thread') {
                    return undefined;
                }
                return value;
            }));
        } catch (error) {
            console.error('Error getting tweet:', error.message);
            return { status: 500, error: `Failed to fetch tweet: ${error.message}` };
        }
    }

    async getUserTweets(credentials, userId, count, useCache = true) {
        try {
            // Check cache if enabled
            if (useCache) {
                const cachedTweets = await this.client.getCachedData(userId, 'user_tweets', TwitterHelper.THIRTY_MINUTES_MS);
                if (cachedTweets) {
                    return cachedTweets;
                }
            }

            const client = await this.client.getClient(credentials);
            const response = await client.getUserTweets(userId, count);
            const tweets = response.tweets;

            // Cache the new results if caching is enabled and we have valid data
            if (useCache && tweets && tweets.length > 0) {
                await this.client.setCachedData(userId, 'user_tweets', tweets, TwitterHelper.THIRTY_MINUTES_MS);
            }

            return tweets;
        } catch (error) {
            console.error('Error getting user tweets:', error.message);
            return { status: 500, error: `Failed to fetch user tweets: ${error.message}` };
        }
    }

    async fetchHomeTimeline(credentials, count, following = false, useCache = true) {
        try {
            const cacheKey = `${credentials.username}_${following ? 'following' : 'home'}_timeline`;
            
            // Check cache if enabled
            if (useCache) {
                const cachedTimeline = await this.client.getCachedData(cacheKey, 'timeline', TwitterHelper.THIRTY_MINUTES_MS);
                if (cachedTimeline) {
                    return cachedTimeline;
                }
            }

            const client = await this.client.getClient(credentials);
            const timeline = following
                ? await client.fetchFollowingTimeline(count, [])
                : await client.fetchHomeTimeline(count, []);

            const formattedTimeline = timeline.map(tweet => ({
                id: tweet.rest_id,
                name: tweet.core?.user_results?.result?.legacy?.name,
                username: tweet.core?.user_results?.result?.legacy?.screen_name,
                text: tweet.legacy?.full_text,
                inReplyToStatusId: tweet.legacy?.in_reply_to_status_id_str,
                timestamp: new Date(tweet.legacy?.created_at).getTime() / 1000,
                userId: tweet.legacy?.user_id_str,
                conversationId: tweet.legacy?.conversation_id_str,
                permanentUrl: `https://twitter.com/${tweet.core?.user_results?.result?.legacy?.screen_name}/status/${tweet.rest_id}`,
                hashtags: tweet.legacy?.entities?.hashtags || [],
                mentions: tweet.legacy?.entities?.user_mentions || [],
                photos: tweet.legacy?.entities?.media
                    ?.filter(media => media.type === "photo")
                    .map(media => ({
                        id: media.id_str,
                        url: media.media_url_https,
                        alt_text: media.alt_text
                    })) || [],
                urls: tweet.legacy?.entities?.urls || [],
                videos: tweet.legacy?.entities?.media
                    ?.filter(media => media.type === "video") || []
            }));

            // Cache the results if enabled and we have valid data
            if (useCache && formattedTimeline && formattedTimeline.length > 0) {
                await this.client.setCachedData(cacheKey, 'timeline', formattedTimeline, TwitterHelper.THIRTY_MINUTES_MS);
            }

            return formattedTimeline;
        } catch (error) {
            console.error('Error fetching home timeline:', error.message);
            return { status: 500, error: `Failed to fetch home timeline: ${error.message}` };
        }
    }

    async searchTweets(credentials, query, maxTweets, searchMode = SearchMode.Latest, cursor, useCache = true) {
        try {
            const cacheKey = `${query}_${searchMode}_${maxTweets}`;
            
            // Check cache if enabled
            if (useCache && !cursor) { // Only use cache for initial searches, not paginated ones
                const cachedResults = await this.client.getCachedData(cacheKey, 'search', TwitterHelper.THIRTY_MINUTES_MS);
                if (cachedResults) {
                    return cachedResults;
                }
            }

            const client = await this.client.getClient(credentials);
            const result = await Promise.race([
                client.fetchSearchTweets(query, maxTweets, searchMode, cursor),
                new Promise((resolve) => setTimeout(() => resolve({ tweets: [] }), 15000))
            ]);

            // Cache the results if enabled, not paginated, and we have valid data
            if (useCache && !cursor && result?.tweets && result.tweets.length > 0) {
                await this.client.setCachedData(cacheKey, 'search', result, TwitterHelper.THIRTY_MINUTES_MS);
            }

            return result ?? { tweets: [] };
        } catch (error) {
            console.error('Error searching tweets:', error.message);
            return { status: 500, error: `Failed to search tweets: ${error.message}` };
        }
    }

    async sendTweet(credentials) {
        try {
            const client = await this.client.getClient(credentials);
            const {text, reply_to_id, quote_tweet_id, mediaData} = credentials;
            let standardTweetResult;
            if (quote_tweet_id && !text){
                await client.retweet(quote_tweet_id);
                return {'retweet': true}
            }
            else if (quote_tweet_id) {
                standardTweetResult = await client.sendQuoteTweet(text, quote_tweet_id, {
                    mediaData: mediaData || []
                });
            } else {
                standardTweetResult = await client.sendTweet(text, reply_to_id, mediaData);
            }
            const body = await standardTweetResult.json();
            if (!body?.data?.create_tweet?.tweet_results?.result) {
                console.error("Error sending tweet; Bad response:", body);
                return { status: 500, error: body.errors[0].message };
            }
            return body.data.create_tweet.tweet_results.result;
        } catch (error) {
            console.error('Error sending tweet:', error.message);
            return { status: 500, error: error.message };
        }
    }

    async sendTweetWithPoll(credentials, text, options, durationMinutes = 120) {
        try {
            const client = await this.client.getClient(credentials);
            return await client.sendTweetV2(text, undefined, {
                poll: {
                    options: options.map(label => ({ label })),
                    durationMinutes
                }
            });
        } catch (error) {
            console.error('Error sending tweet with poll:', error.message);
            return { status: 500, error: `Failed to send tweet with poll: ${error.message}` };
        }
    }

    async getFollowing(credentials, userId, count = 100) {
        try {
            // Check MongoDB cache
            const cachedFollowing = await this.client.getCachedData(userId, 'following');
            if (cachedFollowing) {
                return cachedFollowing;
            }

            const client = await this.client.getClient(credentials);
            const following = [];
            
            // Get the AsyncGenerator from the client
            const followingGenerator = client.getFollowing(userId, count);
            
            // Iterate through the generator and collect profiles
            for await (const profile of followingGenerator) {
                following.push({
                    id: profile.userId,
                    username: profile.username,
                    name: profile.name,
                    bio: profile.biography || '',
                    followersCount: profile.followersCount || 0,
                    followingCount: profile.followingCount || 0,
                    isVerified: profile.isVerified || false,
                    profileImageUrl: profile.avatar
                });
            }
            
            // Cache the following list
            await this.client.setCachedData(userId, 'following', following);
            return following;
        } catch (error) {
            console.error('Error getting following:', error.message);
            return { status: 500, error: `Failed to fetch following users: ${error.message}` };
        }
    }
}