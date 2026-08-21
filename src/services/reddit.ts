import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface RedditPost {
  id: string;
  title: string;
  score: number;
  numComments: number;
  url: string;
}

export interface RedditResponse {
  status: 'success' | 'fallback';
  posts: RedditPost[];
}

export const searchRedditDiscussions = async (query: string): Promise<RedditResponse> => {
  // In Web preview, browser CORS blocks direct client-side requests to reddit.com
  // Gracefully return fallback mode so the UI shows the direct Reddit browser launcher.
  if (!Capacitor.isNativePlatform()) {
    return { status: 'fallback', posts: [] };
  }

  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=3`;
    
    const response = await CapacitorHttp.get({
      url,
      headers: {
        'User-Agent': 'android:com.seenit.app:v1.2.27 (by /u/seenit_app)'
      }
    });

    if (response.status !== 200 || !response.data?.data?.children) {
      return { status: 'fallback', posts: [] };
    }

    const children = response.data.data.children;
    if (children.length === 0) {
      return { status: 'fallback', posts: [] };
    }

    const posts: RedditPost[] = children.map((child: any) => ({
      id: child.data.id,
      title: child.data.title,
      score: child.data.score,
      numComments: child.data.num_comments,
      url: `https://www.reddit.com${child.data.permalink}`
    }));

    return { status: 'success', posts };
  } catch (_error) {
    // Resilient fallback on any network error without throwing or polluting console
    return { status: 'fallback', posts: [] };
  }
};
