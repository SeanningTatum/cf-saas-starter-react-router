#!/usr/bin/env bun
import { main } from "./lint/cli";

process.exit(await main(process.argv.slice(2)));
