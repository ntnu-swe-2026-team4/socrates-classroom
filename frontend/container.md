# 在容器（Container）內執行前端內容

## Linux (Debian/Ubuntu)
> 本節以 **Debian / Ubuntu** 為例（含 Windows 的 WSL 2 Ubuntu）。其他發行版請參考 [Docker 官方文件](https://docs.docker.com/engine/install/)。

### Step 1. 安裝 Docker
1. 加入 Docker 官方 apt 套件庫（Debian 請將下方兩處 `ubuntu` 改為 `debian`）：
    ```sh
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    ```

2. 安裝 Docker Engine：
    ```sh
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
    ```

3. 將目前使用者加入 `docker` 群組，之後執行 docker 指令不需 `sudo`（需重新開啟終端機後生效）：
    ```sh
    sudo usermod -aG docker $USER
    ```

4. 啟動 Docker 服務：
    ```sh
    sudo systemctl enable --now docker
    ```
    > 在 WSL 2 若出現 `System has not been booted with systemd`，請在 `/etc/wsl.conf` 加入 `[boot]` 與 `systemd=true`，再於 PowerShell 執行 `wsl --shutdown` 後重新開啟。若不想自行管理 Docker 服務，也可改裝 Docker Desktop（見下方 Windows 章節），WSL 內即可直接使用 `docker` 指令。

5. 確認安裝成功：
    ```sh
    docker --version
    docker run --rm hello-world
    ```

### Step 2. 建立映像檔並啟動 container
1. 請開啟終端機。<br>假設終端機的路徑已經位於 `/socrates-classroom/` 資料夾，請設定路徑至專案中的 `./frontend/` 資料夾。
    ```sh
    cd ./frontend
    ```

2. 執行 `container-run.sh` 即可建立 docker image 並啟動容器。
    ```sh
    sh container-run.sh
    ```

3. 若成功啟動 container ，終端機則會進入 container 中的 shell 。此時可輸入以下指令，進行前端介面的部署：
    ```sh
    bun run dev --host 0.0.0.0
    ```

4. 於瀏覽器開啟 [http://localhost:5173](http://localhost:5173) 即可看到前端畫面。

---

## macOS
### Step 1. 安裝 Orbstack
> 請先確認您電腦的 OS 版本是否符合 Orbstack 的最低需求。
- 前往 [Orbstack 官網](https://orbstack.dev/download)，下載安裝映像檔（ `.dmg` ）並進行安裝即可啟動。

- 若已安裝 Homebrew ，亦可透過以下指令安裝 Orbstack：
    ```sh
    brew install orbstack
    ```

### Step 2. 建立映像檔並啟動 container
1. 請先啟動 Orbstack，並開啟終端機。<br>假設終端機的路徑已經位於 `/socrates-classroom/` 資料夾，請設定路徑至專案中的 `./frontend/` 資料夾。
    ```sh
    cd ./frontend
    ```

2. 執行 `container-run.sh` 即可建立 docker image 並啟動容器。
    ```sh
    sh container-run.sh
    ```

3. 若成功啟動 container ，終端機則會進入 container 中的 shell 。此時可輸入以下指令，進行前端介面的部署：
    ```sh
    bun run dev --host 0.0.0.0
    ```

4. 於瀏覽器開啟 [http://localhost:5173](http://localhost:5173) 即可看到前端畫面。

---

## Windows
### Step. 1 安裝 Docker Desktop
> 系統需求：Windows 10 22h2 以上，且建議執行於 WSL2。 

- 請確認 BIOS 已開啟 CPU 虛擬化（Intel VT-x / AMD-V，通常預設已開啟）。

- 前往 [Docker Desktop 官網](https://www.docker.com/products/docker-desktop/)，下載 Windows 版安裝程式並執行。

- 安裝時勾選「**Use WSL 2 instead of Hyper-V**」。若尚未安裝 WSL 2，以系統管理員身分開啟 PowerShell 執行以下指令，完成後重新開機：
    ```powershell
    wsl --install
    ```

- 啟動 Docker Desktop，待狀態顯示 *Engine running* 後，確認安裝成功：
    ```sh
    docker --version
    docker run --rm hello-world
    ```

> 授權說明：個人、教育、小型團隊（少於 250 人且年營收低於 1,000 萬美元）可免費使用，大型企業商用需付費授權。

### Step 2. 建立映像檔並啟動 container
`container-run.sh` 是 shell 腳本，PowerShell 與 CMD 無法直接執行，請使用 **Git Bash** 或 **WSL 終端機**。

1. 請先啟動 Docker Desktop，並開啟 Git Bash（或 WSL）。<br>假設終端機的路徑已經位於 `/socrates-classroom/` 資料夾，請設定路徑至專案中的 `./frontend/` 資料夾。
    ```sh
    cd ./frontend
    ```

2. 執行 `container-run.sh` 即可建立 docker image 並啟動容器。
    ```sh
    sh container-run.sh
    ```

3. 若成功啟動 container ，終端機則會進入 container 中的 shell 。此時可輸入以下指令，進行前端介面的部署：
    ```sh
    bun run dev --host 0.0.0.0
    ```

4. 於瀏覽器開啟 [http://localhost:5173](http://localhost:5173) 即可看到前端畫面。

> 建議將專案 clone 到 WSL 的檔案系統內（例如 `~/socrates-classroom`），檔案 I/O 效能遠高於放在 `C:\` 底下。

---

## 常見問題
- **瀏覽器無法連線 `localhost:5173`**：確認啟動指令有加上 `--host 0.0.0.0`，否則 dev server 只監聽容器內部。
- **`port is already allocated`**：本機的 5173 port 已被占用，請先關閉其他 dev server 或舊的容器。
- **`Cannot connect to the Docker daemon`**：Docker 尚未啟動。macOS 請開啟 Orbstack、Windows 請開啟 Docker Desktop、Linux 請執行 `sudo systemctl start docker`。
- **離開容器**：在容器 shell 輸入 `exit`。容器以 `--rm` 啟動，離開後會自動刪除，專案檔案不受影響。
