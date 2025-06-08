export interface FlodeskSubscriber {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  created_at: string;
  updated_at: string;
  status: 'subscribed' | 'unsubscribed';
  segments: FlodeskSegment[];
}

export interface FlodeskSegment {
  id: string;
  name: string;
  color?: string;
  created_at: string;
  subscriber_count: number;
}

export interface FlodeskApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    per_page: number;
  };
}

export class FlodeskAPI {
  private apiKey: string;
  private baseUrl = 'https://api.flodesk.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // Test if API key is valid by making a simple request
  async testConnection(): Promise<boolean> {
    try {
      // Try to list segments as a simple test
      await this.makeRequest<FlodeskSegment[]>('/segments');
      return true;
    } catch (error) {
      console.log('Flodesk API connection test failed:', error);
      return false;
    }
  }

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: any
  ): Promise<FlodeskApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    
    // Flodesk uses Basic authentication with API key as username and empty password
    const authString = btoa(`${this.apiKey}:`);
    const headers: Record<string, string> = {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Flodesk-MCP-Server/1.0.0',
    };

    const config: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      config.body = JSON.stringify(body);
    }

    console.log(`Making Flodesk API request to: ${url}`);
    console.log(`Method: ${method}`);
    console.log(`Headers:`, headers);
    
    const response = await fetch(url, config);
    
    console.log(`Response status: ${response.status}`);
    console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Error response body: ${errorText}`);
      
      let errorMessage: string;
      
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || `HTTP ${response.status}`;
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      }
      
      // Enhanced error message with debugging info
      throw new Error(`Flodesk API error: ${errorMessage} (URL: ${url}, Status: ${response.status})`);
    }

    const responseData = await response.json();
    console.log(`Successful response:`, responseData);
    return responseData as FlodeskApiResponse<T>;
  }

  async addSubscriber(
    email: string,
    firstName?: string,
    lastName?: string,
    segmentIds?: string[]
  ): Promise<FlodeskSubscriber> {
    const body: any = { email };
    
    if (firstName) body.first_name = firstName;
    if (lastName) body.last_name = lastName;
    if (segmentIds && segmentIds.length > 0) body.segment_ids = segmentIds;

    const response = await this.makeRequest<FlodeskSubscriber>('/subscribers', 'POST', body);
    return response.data;
  }

  async getSubscriber(email: string): Promise<FlodeskSubscriber> {
    const response = await this.makeRequest<FlodeskSubscriber>(`/subscribers/${encodeURIComponent(email)}`);
    return response.data;
  }

  async searchSubscribers(query: string, limit: number = 10): Promise<FlodeskSubscriber[]> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
    });
    
    const response = await this.makeRequest<FlodeskSubscriber[]>(`/subscribers/search?${params}`);
    return response.data;
  }

  async listSegments(): Promise<FlodeskSegment[]> {
    const response = await this.makeRequest<FlodeskSegment[]>('/segments');
    return response.data;
  }

  async createSegment(name: string, color?: string): Promise<FlodeskSegment> {
    const body: any = { name };
    if (color) body.color = color;

    const response = await this.makeRequest<FlodeskSegment>('/segments', 'POST', body);
    return response.data;
  }

  async addToSegment(email: string, segmentId: string): Promise<void> {
    await this.makeRequest(
      `/segments/${segmentId}/subscribers`,
      'POST',
      { email }
    );
  }

  async removeFromSegment(email: string, segmentId: string): Promise<void> {
    await this.makeRequest(
      `/segments/${segmentId}/subscribers/${encodeURIComponent(email)}`,
      'DELETE'
    );
  }

  async getSegment(segmentId: string): Promise<FlodeskSegment> {
    const response = await this.makeRequest<FlodeskSegment>(`/segments/${segmentId}`);
    return response.data;
  }
}