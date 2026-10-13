# 1. 建立 image
docker build -t socrates-frontend .

# 2. 啟動容器（掛載專案、開 port、保護 node_modules）
docker run -it --rm \
  --name socrates-frontend \
  -v "$(pwd)":/app \
  -v myproject_node_modules:/app/node_modules \
  -p 5173:5173 \
  socrates-frontend \
  sh