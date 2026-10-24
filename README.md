# RevoQueue Uninstaller (Clone do Revo Uninstaller com Fila / Lote)

Ferramenta desenvolvida para Windows inspirada no **Revo Uninstaller Pro** e **Bulk Crap Uninstaller**, projetada especificamente para desinstalar múltiplos programas sequencialmente em fila (modo lote/batch) e realizar a varredura profunda de sobras no Registro e Disco.

---

## 🚀 Principais Funcionalidades

1. **Fila de Desinstalação em Lote (Batch Uninstall Queue)**:
   - Permite selecionar múltiplos programas via caixas de seleção (*checkboxes*).
   - Executa a desinstalação sequencialmente para evitar conflitos do Windows Installer.
   - Suporte a **Modo Silencioso Automático** (`/qn`, `/SILENT`, `/VERYSILENT`, `/S`, etc.) sem assistentes manuais.

2. **Varredura e Limpeza Profunda de Sobras (Deep Leftover Cleaner)**:
   - **Registro do Windows**: Varre chaves e rastros profundos idênticos ao Revo:
     - `HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags`
     - `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage`
     - `HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache`
     - `HKLM\SYSTEM\CurrentControlSet\Services` (serviços órfãos de programas)
     - `HKLM` e `HKCU\Software\<Publisher>` (chaves residuais da empresa fabricante)
     - Entradas de inicialização automática (`Run` / `RunOnce`).
   - **Envio para a Lixeira (`Recycle Bin`)**:
     - Arquivos e pastas residuais podem ser enviados diretamente para a Lixeira do Windows em vez de exclusão definitiva, permitindo restauração segura caso necessário.

3. **Ícones Oficiais & Detalhes Completos**:
   - Extrai nativamente os logotipos oficiais de cada aplicativo do Windows.
   - Exibe arquitetura exata (**64-bit** ou **32-bit**).
   - Exibe o site oficial/suporte da empresa com link clicável (🌐).

4. **Auto-Updater Integrado & Executável Windows (`RevoQueue.exe`)**:
   - Abra diretamente com 2 cliques pelo **`RevoQueue.exe`** (sem janelas de terminal ou PowerShell).
   - O aplicativo verifica automaticamente novas atualizações no GitHub e permite atualizar com 1 clique.

---

## 🖥️ Como Iniciar a Aplicação

Basta dar dois cliques no executável:
```
RevoQueue.exe
```
*(Ou executar `npm start` se estiver no terminal)*.
