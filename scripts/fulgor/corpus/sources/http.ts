export interface FulgorHttpRequest {
  method: 'GET' | 'POST';
  headers:
    Readonly<Record<string, string>>;
  body?: string;
}

export interface FulgorHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type FulgorHttpFetch = (
  url: string,
  request: FulgorHttpRequest,
) => Promise<FulgorHttpResponse>;

export const defaultFulgorHttpFetch:
  FulgorHttpFetch =
  async (
    url,
    request,
  ) => {
    const response =
      await fetch(
        url,
        {
          method: request.method,
          headers: request.headers,
          body: request.body,
        },
      );

    return {
      ok: response.ok,
      status: response.status,
      json: async () =>
        response.json(),
    };
  };