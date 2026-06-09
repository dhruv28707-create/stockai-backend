import type { ApiHandler } from "../types/api";
import { sendJson } from "../utils/http";

const handler: ApiHandler = (_request, response) => {
  sendJson(response, 200, {
    data: {
      service: "android-ai-stock-assistant-backend",
      status: "ready"
    }
  });
};

export default handler;
