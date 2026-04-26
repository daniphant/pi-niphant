#!/usr/bin/env node
import { discoverSkills } from "./lib.mjs";

const skills = discoverSkills();
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), skills }, null, 2));
