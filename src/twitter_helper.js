import { TwitterClient } from './client.js';

export class TwitterHelper {
    static profiles = {};

    constructor() {
        this.client = new TwitterClient();
    }

    async getProfile(credentials) {
        try {
            if (TwitterHelper.profiles[credentials.username]) {
                return TwitterHelper.profiles[credentials.username];
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
            return profile;
        } catch (error) {
            console.error('Error getting profile:', error.message);
            return { status: 500, error: 'Failed to fetch profile' };
        }
    }

    async getTargetProfile(credentials, targetUsername) {
        try {
            const client = await this.client.getClient(credentials);
            const userProfile = await client.getProfile(targetUsername.replace('@', ''));

            return {
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
        } catch (error) {
            console.error('Error getting target profile:', error.message);
            return { status: 500, error: 'Failed to fetch target profile' };
        }
    }

    async getTweet(credentials, tweetId) {
        try {
            const client = await this.client.getClient(credentials);
            return await client.getTweet(tweetId);
        } catch (error) {
            console.error('Error getting tweet:', error.message);
            return { status: 500, error: 'Failed to fetch tweet' };
        }
    }

    async getUserTweets(credentials, userId, count) {
        try {
            const client = await this.client.getClient(credentials);
            const response = await client.getUserTweets(userId, count);
            return response.tweets;
        } catch (error) {
            console.error('Error getting user tweets:', error.message);
            return { status: 500, error: 'Failed to fetch user tweets' };
        }
    }

    async fetchHomeTimeline(credentials, count, following = false) {
        try {
            const client = await this.client.getClient(credentials);
            const timeline = following
                ? await client.fetchFollowingTimeline(count, [])
                : await client.fetchHomeTimeline(count, []);

            return timeline.map(tweet => ({
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
        } catch (error) {
            console.error('Error fetching home timeline:', error.message);
            return { status: 500, error: 'Failed to fetch home timeline' };
        }
    }

    async searchTweets(credentials, query, maxTweets, searchMode = SearchMode.Latest, cursor) {
        try {
            const client = await this.client.getClient(credentials);
            const result = await Promise.race([
                client.fetchSearchTweets(query, maxTweets, searchMode, cursor),
                new Promise((resolve) => setTimeout(() => resolve({ tweets: [] }), 15000))
            ]);
            return result ?? { tweets: [] };
        } catch (error) {
            console.error('Error searching tweets:', error.message);
            return { status: 500, error: 'Failed to search tweets' };
        }
    }

    async sendTweet(credentials) {
        try {
            const client = await this.client.getClient(credentials);
            const {text, reply_to_id, quote_tweet_id} = credentials;
            let standardTweetResult;
            if (quote_tweet_id && !text){
                await client.retweet(quote_tweet_id);
                return {'retweet': true}
            }
            else if (quote_tweet_id) {
                standardTweetResult = await client.sendQuoteTweet(text, quote_tweet_id);
            } else {
                standardTweetResult = await client.sendTweet(text, reply_to_id);
            }
            const body = await standardTweetResult.json();
            if (!body?.data?.create_tweet?.tweet_results?.result) {
                console.error("Error sending tweet; Bad response:", body);
                return { status: 500, error: 'Failed to send tweet' };
            }
            return body.data.create_tweet.tweet_results.result;
        } catch (error) {
            console.error('Error sending tweet:', error.message);
            return { status: 500, error: 'Failed to send tweet' };
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
            return { status: 500, error: 'Failed to send tweet with poll' };
        }
    }
}