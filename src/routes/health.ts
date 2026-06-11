import type { ApiHandler } from "../../types/api";
import { sendJson } from "../../utils/http";

const handler: ApiHandler = (_request, response) => {
  sendJson(response, 200, {
    data: {
      status: "ok",
      timestamp: new Date().toISOString()
    }
  });
};

export default handler;


