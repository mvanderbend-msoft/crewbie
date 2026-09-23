import { readFileSync } from "node:fs";
import { record, string } from "../core.js";

const manifest = record(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as unknown, "package manifest");
const version = string(manifest.version, "package version");
const filename = `${string(manifest.name, "package name").replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
export const PACKAGE_PIN = `https://github.com/mvanderbend-msoft/crewbie/releases/download/v${version}/${filename}`;
