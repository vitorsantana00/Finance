# Nubank Manual (Expo / React Native)

App móvel **manual** (sem CSV e sem bancos) para controle financeiro com **SQLite local**:
- **Dashboard**: Entradas (X), Saídas, Saldo, Fixo planejado (Y), Fixo realizado, Variável planejado (X−Y), Variável restante
- **Lançar**: adicionar **Receita** e **Despesa** rapidamente
- **Categorias**: criar/editar e marcar **É fixa?**
- **Fixos**: cadastre itens fixos (valor/dia/categoria) e gere os lançamentos do mês com 1 toque
- **Config**: defina o **Y** (orçamento fixo mensal)

## Requisitos (Windows)
- Node LTS: https://nodejs.org
- Git (opcional): https://git-scm.com
- VS Code (recomendado): https://code.visualstudio.com
- Expo Go (iPhone): App Store

## Como rodar
```bash
npm install -g eas-cli  # opcional, para builds no futuro
npm install
npx expo start
```
Abra o **QR Code** no iPhone com a câmera → **Expo Go** carrega o app.

## GitHub (backup do código)
```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/nubank-manual.git
git push -u origin main
```

## Build (quando quiser)
- **Android (APK/AAB)**: `eas build --platform android` (precisa `eas login`)
- **iOS (TestFlight/App Store)**: `eas build --platform ios` (precisa Apple Developer)

---
Este projeto é seu ponto de partida (Caminho A). UI/UX simples para evoluir depois.
