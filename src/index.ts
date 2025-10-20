#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import crypto from 'crypto';

// Define interfaces for FreshRSS API responses
interface FreshRSSItem {
  id: string;
  feed_id: number;
  title: string;
  author?: string;
  html: string;
  url: string;
  is_saved: number;
  is_read: number;
  created_on_time: number;
}

interface FreshRSSResponse {
  api_version: number;
  auth: number;
  last_refreshed_on_time: number;
  total_items?: number;
  items?: FreshRSSItem[];
  feeds?: any[];
  feeds_groups?: any[];
  groups?: any[];
}

// FreshRSS API client class
class FreshRSSClient {
  private apiUrl: string;
  private username: string;
  private password: string;
  private apiKey: string | null = null;

  constructor(apiUrl: string, username: string, password: string) {
    this.apiUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.username = username;
    this.password = password;
    // Generate API key for Fever API using MD5(username:password)
    this.apiKey = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
  }

  private async request<T>(endpoint: string = '', method: string = 'GET', data: any = {}): Promise<T> {
    try {
      // The Fever API requires a POST request with api_key for authentication
      // even for GET-like operations
      const requestData = new URLSearchParams({
        api_key: this.apiKey,
        ...data
      });

      const response = await axios({
        method: 'POST', // Always use POST for Fever API
        url: `${this.apiUrl}/api/fever.php`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        data: requestData,
      });

      if (!response.data?.api_version) {
        throw new Error('Invalid API response');
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new McpError(
          ErrorCode.InternalError,
          `FreshRSS API error: ${error.response?.data?.error || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Convert a date to a Fever API item ID (microseconds since epoch)
   * Fever API uses item IDs that are timestamps in microseconds
   */
  private dateToFeverItemId(date: Date): string {
    // Convert milliseconds to microseconds (multiply by 1000)
    return (date.getTime() * 1000).toString();
  }

  /**
   * Get the date/time for X hours ago
   */
  private getHoursAgo(hours: number): Date {
    const date = new Date();
    date.setHours(date.getHours() - hours);
    return date;
  }

  /**
   * Get the date/time for X days ago
   */
  private getDaysAgo(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  // Get feed subscriptions
  async getSubscriptions() {
    return this.request('', 'GET', { feeds: '' });
  }

  // Get feed groups
  async getFeedGroups() {
    return this.request('', 'GET', { groups: '' });
  }

  // Get unread items
  async getUnreadItems(): Promise<FreshRSSResponse> {
    // Get all items and filter them on our side
    const response = await this.request<FreshRSSResponse>('', 'GET', {
      items: ''
    });

    // Filter to only include unread items
    if (response.items && Array.isArray(response.items)) {
      response.items = response.items.filter(item => item.is_read === 0);

      // Update total_items count
      if (response.total_items !== undefined) {
        response.total_items = response.items.length;
      }
    }

    return response;
  }

  // Get feed items
  async getFeedItems(feedId: number | string): Promise<FreshRSSResponse> {
    // Ensure feedId is a number as required by the Fever API
    const numericFeedId = typeof feedId === 'string' ? parseInt(feedId, 10) : feedId;

    return this.request<FreshRSSResponse>('', 'GET', {
      items: '',
      feed_ids: numericFeedId
    });
  }

  /**
   * Get items from the last X hours
   */
  async getItemsFromLastHours(hours: number): Promise<FreshRSSResponse> {
    const sinceDate = this.getHoursAgo(hours);
    const sinceId = this.dateToFeverItemId(sinceDate);
    
    return this.request<FreshRSSResponse>('', 'GET', {
      items: '',
      since_id: sinceId
    });
  }

  /**
   * Get items from the last X days
   */
  async getItemsFromLastDays(days: number): Promise<FreshRSSResponse> {
    const sinceDate = this.getDaysAgo(days);
    const sinceId = this.dateToFeverItemId(sinceDate);
    
    return this.request<FreshRSSResponse>('', 'GET', {
      items: '',
      since_id: sinceId
    });
  }

  /**
   * Get items from a specific feed from the last X hours
   */
  async getFeedItemsFromLastHours(feedId: number | string, hours: number): Promise<FreshRSSResponse> {
    const numericFeedId = typeof feedId === 'string' ? parseInt(feedId, 10) : feedId;
    const sinceDate = this.getHoursAgo(hours);
    const sinceId = this.dateToFeverItemId(sinceDate);
    
    return this.request<FreshRSSResponse>('', 'GET', {
      items: '',
      feed_ids: numericFeedId,
      since_id: sinceId
    });
  }

  /**
   * Get items from a specific feed from the last X days
   */
  async getFeedItemsFromLastDays(feedId: number | string, days: number): Promise<FreshRSSResponse> {
    const numericFeedId = typeof feedId === 'string' ? parseInt(feedId, 10) : feedId;
    const sinceDate = this.getDaysAgo(days);
    const sinceId = this.dateToFeverItemId(sinceDate);
    
    return this.request<FreshRSSResponse>('', 'GET', {
      items: '',
      feed_ids: numericFeedId,
      since_id: sinceId
    });
  }

  /**
   * Get items from a specific date range
   */
  async getItemsFromDateRange(sinceDate: Date, untilDate?: Date): Promise<FreshRSSResponse> {
    const sinceId = this.dateToFeverItemId(sinceDate);
    
    const params: any = {
      items: '',
      since_id: sinceId
    };
    
    // If untilDate is specified, use max_id to limit the range
    if (untilDate) {
      params.max_id = this.dateToFeverItemId(untilDate);
    }
    
    return this.request<FreshRSSResponse>('', 'GET', params);
  }

  /**
   * Get items from a group (category) from the last X days
   */
  async getGroupItemsFromLastDays(groupId: number | string, days: number): Promise<FreshRSSResponse> {
    const numericGroupId = typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;
    const sinceDate = this.getDaysAgo(days);
    const sinceId = this.dateToFeverItemId(sinceDate);
    
    return this.request<FreshRSSResponse>('', 'GET', {
      items: '',
      group_ids: numericGroupId,
      since_id: sinceId
    });
  }

  /**
   * Get just titles and URLs from feed items from the last X days
   */
  async getFeedTitlesFromLastDays(feedId: number | string, days: number): Promise<{ id: string; title: string; url: string; created_on_time: number }[]> {
    const response = await this.getFeedItemsFromLastDays(feedId, days);
    
    if (!response.items || !Array.isArray(response.items)) {
      return [];
    }
    
    return response.items.map(item => ({
      id: item.id,
      title: item.title,
      url: item.url,
      created_on_time: item.created_on_time
    }));
  }

  /**
   * Get just titles and URLs from feed items from the last X hours
   */
  async getFeedTitlesFromLastHours(feedId: number | string, hours: number): Promise<{ id: string; title: string; url: string; created_on_time: number }[]> {
    const response = await this.getFeedItemsFromLastHours(feedId, hours);
    
    if (!response.items || !Array.isArray(response.items)) {
      return [];
    }
    
    return response.items.map(item => ({
      id: item.id,
      title: item.title,
      url: item.url,
      created_on_time: item.created_on_time
    }));
  }

  /**
   * Get just titles and URLs from all items from the last X days
   */
  async getTitlesFromLastDays(days: number): Promise<{ id: string; title: string; url: string; feed_id: number; created_on_time: number }[]> {
    const response = await this.getItemsFromLastDays(days);
    
    if (!response.items || !Array.isArray(response.items)) {
      return [];
    }
    
    return response.items.map(item => ({
      id: item.id,
      title: item.title,
      url: item.url,
      feed_id: item.feed_id,
      created_on_time: item.created_on_time
    }));
  }

  // Mark item as read
  async markAsRead(itemId: string) {
    return this.request('', 'POST', {
      mark: 'item',
      id: itemId,
      as: 'read'
    });
  }

  // Mark item as unread
  async markAsUnread(itemId: string) {
    return this.request('', 'POST', {
      mark: 'item',
      id: itemId,
      as: 'unread'
    });
  }

  // Mark all items in a feed as read
  async markFeedAsRead(feedId: string) {
    return this.request('', 'POST', {
      mark: 'feed',
      id: feedId,
      as: 'read',
      before: Math.floor(Date.now() / 1000)
    });
  }

  // Get specific items by IDs
  async getItems(itemIds: string[]) {
    return this.request('', 'GET', {
      items: '',
      with_ids: itemIds.join(',')
    });
  }
}

// Initialize server
const apiUrl = process.env.FRESHRSS_API_URL;
const username = process.env.FRESHRSS_USERNAME;
const password = process.env.FRESHRSS_PASSWORD;

if (!apiUrl || !username || !password) {
  throw new Error('FRESHRSS_API_URL, FRESHRSS_USERNAME, and FRESHRSS_PASSWORD environment variables are required');
}

const client = new FreshRSSClient(apiUrl, username, password);

const server = new Server(
  {
    name: "freshrss-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_feeds",
      description: "List all feed subscriptions",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_feed_groups",
      description: "Get feed groups",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_unread",
      description: "Get unread items",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_feed_items",
      description: "Get items from a specific feed",
      inputSchema: {
        type: "object",
        properties: {
          feed_id: {
            type: "string",
            description: "Feed ID",
          },
        },
        required: ["feed_id"],
      },
    },
    {
      name: "get_items_last_hours",
      description: "Get items from the last X hours",
      inputSchema: {
        type: "object",
        properties: {
          hours: {
            type: "number",
            description: "Number of hours to look back",
          },
        },
        required: ["hours"],
      },
    },
    {
      name: "get_items_last_days",
      description: "Get items from the last X days",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to look back",
          },
        },
        required: ["days"],
      },
    },
    {
      name: "get_feed_items_last_hours",
      description: "Get items from a specific feed from the last X hours",
      inputSchema: {
        type: "object",
        properties: {
          feed_id: {
            type: "string",
            description: "Feed ID",
          },
          hours: {
            type: "number",
            description: "Number of hours to look back",
          },
        },
        required: ["feed_id", "hours"],
      },
    },
    {
      name: "get_feed_items_last_days",
      description: "Get items from a specific feed from the last X days",
      inputSchema: {
        type: "object",
        properties: {
          feed_id: {
            type: "string",
            description: "Feed ID",
          },
          days: {
            type: "number",
            description: "Number of days to look back",
          },
        },
        required: ["feed_id", "days"],
      },
    },
    {
      name: "get_group_items_last_days",
      description: "Get items from a group (category) from the last X days",
      inputSchema: {
        type: "object",
        properties: {
          group_id: {
            type: "string",
            description: "Group ID",
          },
          days: {
            type: "number",
            description: "Number of days to look back",
          },
        },
        required: ["group_id", "days"],
      },
    },
    {
      name: "get_feed_titles_last_days",
      description: "Get just titles and URLs from a specific feed from the last X days",
      inputSchema: {
        type: "object",
        properties: {
          feed_id: {
            type: "string",
            description: "Feed ID",
          },
          days: {
            type: "number",
            description: "Number of days to look back",
          },
        },
        required: ["feed_id", "days"],
      },
    },
    {
      name: "get_feed_titles_last_hours",
      description: "Get just titles and URLs from a specific feed from the last X hours",
      inputSchema: {
        type: "object",
        properties: {
          feed_id: {
            type: "string",
            description: "Feed ID",
          },
          hours: {
            type: "number",
            description: "Number of hours to look back",
          },
        },
        required: ["feed_id", "hours"],
      },
    },
    {
      name: "get_titles_last_days",
      description: "Get just titles and URLs from all items from the last X days",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to look back",
          },
        },
        required: ["days"],
      },
    },
    {
      name: "mark_item_read",
      description: "Mark an item as read",
      inputSchema: {
        type: "object",
        properties: {
          item_id: {
            type: "string",
            description: "Item ID to mark as read",
          },
        },
        required: ["item_id"],
      },
    },
    {
      name: "mark_item_unread",
      description: "Mark an item as unread",
      inputSchema: {
        type: "object",
        properties: {
          item_id: {
            type: "string",
            description: "Item ID to mark as unread",
          },
        },
        required: ["item_id"],
      },
    },
    {
      name: "mark_feed_read",
      description: "Mark all items in a feed as read",
      inputSchema: {
        type: "object",
        properties: {
          feed_id: {
            type: "string",
            description: "Feed ID to mark as read",
          },
        },
        required: ["feed_id"],
      },
    },
    {
      name: "get_items",
      description: "Get specific items by their IDs",
      inputSchema: {
        type: "object",
        properties: {
          item_ids: {
            type: "array",
            items: {
              type: "string",
            },
            description: "Array of item IDs to get",
          },
        },
        required: ["item_ids"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "list_feeds": {
        const response = await client.getSubscriptions();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_feed_groups": {
        const response = await client.getFeedGroups();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_unread": {
        const response = await client.getUnreadItems();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_feed_items": {
        const { feed_id } = request.params.arguments as { feed_id: string };
        const response = await client.getFeedItems(feed_id);

        // Filter items to only include those from the requested feed
        if (response.items && Array.isArray(response.items)) {
          const numericFeedId = parseInt(feed_id, 10);
          response.items = response.items.filter((item: FreshRSSItem) => item.feed_id === numericFeedId);

          // Update total_items count to reflect the filtered items
          if (response.total_items !== undefined) {
            response.total_items = response.items.length;
          }
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_items_last_hours": {
        const { hours } = request.params.arguments as { hours: number };
        const response = await client.getItemsFromLastHours(hours);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_items_last_days": {
        const { days } = request.params.arguments as { days: number };
        const response = await client.getItemsFromLastDays(days);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_feed_items_last_hours": {
        const { feed_id, hours } = request.params.arguments as { feed_id: string; hours: number };
        const response = await client.getFeedItemsFromLastHours(feed_id, hours);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_feed_items_last_days": {
        const { feed_id, days } = request.params.arguments as { feed_id: string; days: number };
        const response = await client.getFeedItemsFromLastDays(feed_id, days);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_group_items_last_days": {
        const { group_id, days } = request.params.arguments as { group_id: string; days: number };
        const response = await client.getGroupItemsFromLastDays(group_id, days);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(response, null, 2),
          }],
        };
      }

      case "get_feed_titles_last_days": {
        const { feed_id, days } = request.params.arguments as { feed_id: string; days: number };
        const titles = await client.getFeedTitlesFromLastDays(feed_id, days);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(titles, null, 2),
          }],
        };
      }

      case "get_feed_titles_last_hours": {
        const { feed_id, hours } = request.params.arguments as { feed_id: string; hours: number };
        const titles = await client.getFeedTitlesFromLastHours(feed_id, hours);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(titles, null, 2),
          }],
        };
      }

      case "get_titles_last_days": {
        const { days } = request.params.arguments as { days: number };
        const titles = await client.getTitlesFromLastDays(days);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(titles, null, 2),
          }],
        };
      }

      case "mark_item_read": {
        const { item_id } = request.params.arguments as { item_id: string };
        await client.markAsRead(item_id);
        return {
          content: [{
            type: "text",
            text: `Successfully marked item ${item_id} as read`,
          }],
        };
      }

      case "mark_item_unread": {
        const { item_id } = request.params.arguments as { item_id: string };
        await client.markAsUnread(item_id);
        return {
          content: [{
            type: "text",
            text: `Successfully marked item ${item_id} as unread`,
          }],
        };
      }

      case "mark_feed_read": {
        const { feed_id } = request.params.arguments as { feed_id: string };
        await client.markFeedAsRead(feed_id);
        return {
          content: [{
            type: "text",
            text: `Successfully marked all items in feed ${feed_id} as read`,
          }],
        };
      }

      case "get_items": {
        const { item_ids } = request.params.arguments as { item_ids: string[] };
        const items = await client.getItems(item_ids);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(items, null, 2),
          }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(ErrorCode.InternalError, String(error));
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('FreshRSS MCP server running on stdio');
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});