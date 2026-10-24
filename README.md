# Queu Uninstaller

Desinstalador avançado para Windows projetado especificamente para remoção de múltiplos programas sequencialmente em lote (fila de desinstalação) e varredura profunda de resíduos no Registro e Disco.

---

## 🚀 Principais Recursos

1. **Fila de Desinstalação em Lote (Batch Queue)**:
   - Seleção múltipla rápida com caixas de seleção (*checkboxes*).
   - Execução sequencial automática para evitar conflitos de processos do Windows Installer.
   - Suporte a **Modo Silencioso Automático** (`/qn`, `/SILENT`, `/VERYSILENT`, `/S`, etc.) sem assistentes visuais manuais.

2. **Varredura e Limpeza Profunda de Sobras**:
   - **Registro do Windows**: Localiza resíduos órfãos em:
     - `HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags`
     - `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage`
     - `HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache`
     - `HKLM\SYSTEM\CurrentControlSet\Services` (serviços descontinuados)
     - `HKLM` e `HKCU\Software\<Fabricante>`
     - Entradas de inicialização automática (`Run` / `RunOnce`).
   - **Envio para a Lixeira do Windows**:
     - Arquivos e pastas residuais podem ser enviados diretamente para a Lixeira (`Recycle Bin`) em vez de exclusão definitiva, permitindo restauração segura se desejado.

3. **Visual Moderno & Dados Completos**:
   - Logotipos e ícones oficiais extraídos diretamente do Windows.
   - Identificação da arquitetura (**64-bit** e **32-bit**).
   - Link direto para o site oficial do desenvolvedor (🌐).
   - Estimativa em tempo real de espaço liberado em disco.

4. **Executável Nativo & Atualização Automática**:
   - Inicie diretamente com 2 cliques pelo **`QueuUninstaller.exe`** (sem terminais).
   - O aplicativo verifica automaticamente novos commits no repositório e permite atualizar com 1 clique.

---

## 🖥️ Como Executar

Basta dar dois cliques no executável:
```
QueuUninstaller.exe
```
*(Ou executar `npm start` via terminal)*.
