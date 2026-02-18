/*
  server/mail/gmail.auth.cjs
  One-time Gmail OAuth authorization helper
*/

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const readline = require("readline");

const OAUTH_PATH = path.join(__dirname, "..", "secrets", "gmail-oauth.json");

const TOKEN_PATH = path.join(__dirname, "..", "secrets", "gmail-token.json");

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

function loadOAuthClient() {
  const raw = JSON.parse(fs.readFileSync(OAUTH_PATH, "utf8"));
  const cfg = raw.installed || raw.web;

  return new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    "urn:ietf:wg:oauth:2.0:oob"
  );
}

async function run() {
  const oauth2Client = loadOAuthClient();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n👉 Otwórz ten link w przeglądarce:\n");
  console.log(authUrl);
  console.log("\nPo zalogowaniu skopiuj KOD i wklej tutaj ↓\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("Kod: ", async (code) => {
    rl.close();

    const { tokens } = await oauth2Client.getToken(code.trim());
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log("\n✅ gmail-token.json zapisany");
  });
}

run().catch((e) => {
  console.error("AUTH ERROR:", e);
});
