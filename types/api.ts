export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface ApiResponseWriter {
  status: (statusCode: number) => ApiResponseWriter;
  json: (payload: ApiResponse) => void;
}

export type ApiHandler = (
  request: ApiRequest,
  response: ApiResponseWriter
) => void | Promise<void>;

export interface ApiResponse<TData = unknown> {
  data?: TData;
  error?: {
    code: string;
    message: string;
  };
}
