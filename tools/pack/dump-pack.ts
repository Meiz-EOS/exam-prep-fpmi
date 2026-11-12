import { resolve } from "node:path";
import { buildPack } from "./build-pack.ts";
import { loadSettings } from "../lib/settings.ts";

const packDir = process.argv[2] ? resolve(process.argv[2]) : loadSettings().pack;
process.stdout.write(`${JSON.stringify(buildPack(packDir))}\n`);
