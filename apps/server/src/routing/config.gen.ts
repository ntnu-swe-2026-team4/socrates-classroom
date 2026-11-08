import { RoutingConfigSchema, type RoutingConfig } from "./routing-schema";

// 由 providers.config.yaml 產生（build-time）；改 YAML 後重跑 scripts/gen-config.mjs
const CONFIG = {
  "providers": {
    "dgx-spark": {
      "kind": "openai-completions",
      "model": "GLM-5.3-Flash-EXL3",
      "baseUrlEnv": "DGX_BASE_URL",
      "cost": "free"
    },
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
      ],
      "params": {
        "thinking": {
          "type": "disabled"
        }
      }
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
    "pseudonymPrefix": "學生"
  },
  "defaults": {
    "availability": [
      {
        "provider": "dgx-spark",
        "credential": "platform",
        "maxConcurrency": 4,
        "priority": 1
      },
      {
        "provider": "workers-ai",
        "model": "@cf/zai-org/glm-5.3-flash",
        "credential": "platform",
        "maxConcurrency": 20,
        "priority": 2
      },
      {
        "provider": "workers-ai",
        "model": "@cf/zai-org/glm-4.7-flash",
        "credential": "platform",
        "maxConcurrency": 50,
        "priority": 3
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

export const routingConfig: RoutingConfig = RoutingConfigSchema.parse(CONFIG);
