import { GatewayConfigSchema, type GatewayConfig } from "./gateway-schema";

// Generated from providers.config.yaml (build time); rerun scripts/gen-config.mjs after editing the YAML
const CONFIG = {
  "providers": {
    "workers-ai": {
      "kind": "binding",
      "models": [
        {
          "id": "@cf/zai-org/glm-5.3-flash",
          "cost": "paid"
        },
        {
          "id": "@cf/zai-org/glm-4.7-flash",
          "cost": "free"
        }
      ]
    },
    "openrouter": {
      "kind": "openai-completions",
      "model": "z-ai/glm-5.3-flash",
      "baseUrl": "https://openrouter.ai/api/v1",
      "cost": "paid"
    },
    "glm": {
      "kind": "openai-completions",
      "model": "glm-4.6",
      "baseUrl": "https://api.z.ai/api/coding/paas/v4",
      "cost": "paid",
      "models": [
        {
          "id": "glm-4.6",
          "cost": "paid"
        },
        {
          "id": "glm-4.7",
          "cost": "paid"
        },
        {
          "id": "glm-5.3",
          "cost": "paid"
        },
        {
          "id": "glm-4.5-air",
          "cost": "paid"
        }
      ]
    }
  },
  "classifiers": {
    "emotion": "@cf/cloudflare/clef-flash",
    "violation": "@cf/cloudflare/clef-flash"
  },
  "voice": {
    "stt": "@cf/openai/whisper-large-v3-turbo",
    "tts": "@cf/myshell-ai/melotts"
  },
  "report": {
    "studentAttempts": 2,
    "alarmAttempts": 3,
    "alarmBackoffMs": 4000,
    "alarmTimeoutMs": 300000,
    "pseudonymPrefix": "學生"
  },
  "teacherChain": {
    "maxConcurrency": 4
  },
  "defaults": {
    "availability": [
      {
        "provider": "workers-ai",
        "model": "@cf/zai-org/glm-5.3-flash",
        "credential": "platform",
        "maxConcurrency": 20,
        "priority": 1
      },
      {
        "provider": "workers-ai",
        "model": "@cf/zai-org/glm-4.7-flash",
        "credential": "platform",
        "maxConcurrency": 50,
        "priority": 2
      }
    ]
  },
  "trafficClasses": {
    "interactive": {
      "availability": "defaults"
    },
    "judgment": {
      "availability": "defaults"
    },
    "batch": {
      "availability": "defaults"
    }
  }
} as unknown;

export const gatewayConfig: GatewayConfig = GatewayConfigSchema.parse(CONFIG);
