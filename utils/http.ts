import type { ApiResponse, ApiResponseWriter } from "../types/api";

export const sendJson = <TData>(
  response: ApiResponseWriter,
  statusCode: number,
  payload: ApiResponse<TData>
): void => {
  response.status(statusCode).json(payload);
};

export const sendError = (
  response: ApiResponseWriter,
  statusCode: number,
  code: string,
  message: string
): void => {
  sendJson(response, statusCode, {
    error: {
      code,
      message
    }
  });
};
