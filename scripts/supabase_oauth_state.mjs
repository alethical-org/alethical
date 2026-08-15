#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

const [operation, inputPath, outputPath] = process.argv.slice(2);
const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET;
const additionalData = Buffer.from("alethical-supabase-oauth-state-v1");

if (!clientSecret || !operation || !inputPath || !outputPath) {
  throw new Error("Supabase OAuth state arguments are incomplete");
}

const key = crypto.createHash("sha256").update(clientSecret).digest();

if (operation === "encrypt") {
  const plaintext = fs.readFileSync(inputPath);
  if (plaintext.length === 0) throw new Error("Supabase OAuth state is empty");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const state = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
} else if (operation === "decrypt") {
  const state = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (state.version !== 1 || state.algorithm !== "aes-256-gcm") {
    throw new Error("Supabase OAuth state format is unsupported");
  }

  const iv = Buffer.from(state.iv, "base64");
  const tag = Buffer.from(state.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Supabase OAuth state format is invalid");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16,
  });
  decipher.setAAD(additionalData);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(state.ciphertext, "base64")),
    decipher.final(),
  ]);
  if (plaintext.length === 0) throw new Error("Supabase OAuth state is empty");
  fs.writeFileSync(outputPath, plaintext, { mode: 0o600 });
} else {
  throw new Error("Supabase OAuth state operation is unsupported");
}
