# LM Studio e APIs compatíveis com OpenAI

A plataforma inclui o provedor **API compatível / Local**, que usa `GET /models` para testar e descobrir modelos e `POST /chat/completions` para gerar respostas. Não depende do endpoint Responses da OpenAI. O endereço pode conter um prefixo de API personalizado; informe a URL base completa, incluindo `/v1` quando necessário.

## Autorizar o destino

O administrador geral abre **Administração da plataforma → Endpoints de IA** e cadastra a origem permitida, por exemplo:

```text
http://127.0.0.1:1234
http://192.168.3.50:1234
https://llm.suaempresa.com
```

A autorização considera protocolo, hostname e porta. Não autorize destinos que você não controla ou nos quais não confia. Endpoints não autorizados são recusados; redirecionamentos HTTP não são seguidos. Remover uma origem impede novas resoluções da configuração que usa esse destino. Provedores oficiais continuam usando seus endereços fixos.

## Configurar o workspace

1. No LM Studio, carregue um modelo e inicie seu servidor de API. Para acesso de outra máquina, habilite a escuta na rede e ajuste o firewall.
2. Em **Configurações → Inteligência artificial**, o proprietário seleciona **API compatível / Local**.
3. Informe a URL base, por exemplo `http://192.168.3.50:1234/v1`, e o identificador exato do modelo.
4. Informe a chave, se o servidor exigir autenticação Bearer. Caso contrário, marque **Este endpoint não exige chave de API**.
5. Salve e use **Testar conexão**. Esse teste lista modelos sem enviar dados de servidores ou gerar texto. Se necessário, selecione o ID retornado e salve novamente.
6. Selecione esse provedor nas preferências ou alterne para ele no seletor do assistente.

`localhost` e `127.0.0.1` referem-se ao servidor da plataforma, não ao computador que abriu o navegador. Se o LM Studio estiver no Windows e a plataforma no Ubuntu, utilize um endereço do Windows alcançável pelo Ubuntu. Um endereço privado exige conectividade de rede ou VPN; ele não se torna acessível a uma VPS apenas por ser informado no painel.

A chave opcional é criptografada como as demais credenciais, isolada por workspace e enviada somente no cabeçalho Authorization quando presente. O endpoint recebe os prompts e os dados autorizados daquele workspace. Autenticação, TLS e conectividade do servidor de modelos são configurados no serviço que hospeda o LLM.

A geração permite até 120 segundos de espera para esse provedor. O desempenho e a qualidade dependem do modelo e do hardware. Os limites do plano da plataforma continuam sendo aplicados, mesmo quando o modelo é local; não há consumo de uma API externa paga quando o destino é seu servidor local.

As permissões e aprovações para comandos no servidor monitorado permanecem as mesmas. O uso de um LLM local não concede autorização adicional de execução. Os testes automatizados usam endpoints simulados; valide com seu servidor e modelo reais.

Referência: [API compatível do LM Studio](https://lmstudio.ai/docs/developer/openai-compat).
