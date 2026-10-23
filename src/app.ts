import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import privacyRouter from "./routes/privacy";
import { logger } from "./lib/logger";

const app: Express = express();

// The marketing site + affiliate signup/login/dashboard pages. Plain static
// HTML/CSS/JS (no build step) living in /public at the repo root, served
// from the same Express app/same Render service as the API -- the mobile
// app only has one configurable backend URL (EXPO_PUBLIC_API_BASE_URL), so
// keeping everything on one origin avoids needing a second deployment and
// CORS setup just for the website to talk to its own API.
//
// esbuild's banner (see build.mjs) rebinds __dirname to point at dist/
// inside the bundled output, so this resolves to <repo-root>/public at
// runtime regardless of the process's actual working directory.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Raised from Express's default ~100kb limit: the admin payout-recording
// flow (item h) accepts a base64-encoded payment-screenshot data URL directly
// in the JSON body (no multer/file-upload dependency needed) -- a phone
// screenshot easily exceeds 100kb once base64-encoded.
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

// extensions: ["html"] lets clean URLs like /terms and /privacy resolve
// to terms.html/privacy.html -- the in-app Terms screen (TermsModal.tsx)
// already tells users to visit "digitox.club/terms" without the extension.
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

app.use("/api", router);
app.use("/api/privacy", privacyRouter);

export default app;
