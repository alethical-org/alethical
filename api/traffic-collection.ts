type RequestLike = { method?: string; body?: unknown };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

// Collection decisions now require a verified bearer token at the backend.
// Retired clients fail closed instead of using caller-supplied account IDs.
export default function handler(_request: RequestLike, response: ResponseLike) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store");
  response
    .status(410)
    .send(
      JSON.stringify({ error: "Reload to use the current collection check." }),
    );
}
