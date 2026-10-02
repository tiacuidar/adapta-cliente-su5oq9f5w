// LT-1-T04 — Painel de cobertura operacional (SPEC-1-003)
// GET /backend/v1/painel/cobertura?empresa=acuidar|donahelp&mes=YYYY-MM
// Regras aprovadas:
//   RN-1-16: janela de análise = por mês e por unidade, separadamente
//   RN-1-18: elegibilidade total — toda unidade ativa aparece; sem registro no mês = reuniao_pendente
//   RN-1-14: fonte indisponível/sem timestamp → dados_indisponiveis com fonte+timestamp, fora da contagem
//   RN-1-15: rótulos "Cobertura operacional"/"Qualidade do registro" — NUNCA Health Score/peso/faixa/ranking
//   RN-1-19: sem inferência por suposição
// Somente leitura: não escreve em nenhuma fonte. RLS: todos autenticados (F1-T08).

routerAdd('GET', '/backend/v1/painel/cobertura', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  // JSVM: campos de record via getString — nunca propriedade (AP-2026-10-02-1150)
  const q = e.requestInfo().query || {}
  const empresa = String(q.empresa || 'acuidar')
  const mes = String(q.mes || '') // YYYY-MM; vazio = mês atual

  if (empresa !== 'acuidar' && empresa !== 'donahelp') {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Empresa inválida. Use acuidar ou donahelp.',
    })
  }

  // Mês de análise (padrão: mês atual UTC)
  const agora = new Date()
  const mesAlvo = /^\d{4}-\d{2}$/.test(mes) ? mes : agora.toISOString().slice(0, 7)
  const [anoStr, mesStr] = mesAlvo.split('-')
  const prefixo = mesAlvo + '-' // para comparar data_fato "YYYY-MM-..."

  // 1. Unidades da empresa (via proxy existente da LT-1-T02 — reuso, não reescrita)
  let unidades = []
  let unidadesOk = true
  let unidadesTimestamp = ''
  try {
    // Chamar a lógica do proxy internamente: buscar direto da fonte com o secret
    const tokenName = empresa === 'acuidar' ? 'ACUIDAR_PORTAL_TOKEN' : 'DONAHELP_PORTAL_TOKEN'
    const url =
      empresa === 'acuidar'
        ? 'https://app.acuidarbr.com.br/api/dados/unidades'
        : 'https://app.donahelpbr.com.br/api/dados/unidades'

    const token = $secrets.get(tokenName)
    if (!token) {
      unidadesOk = false
    } else {
      const res = $http.send({
        url: url,
        method: 'GET',
        headers: { Authorization: token },
        timeout: 10,
      })
      if (res.statusCode === 200) {
        // res.body é bytes (AP-2026-09-30-1715) — res.json já traz o objeto parseado
        let parsed = null
        if (res.json && typeof res.json === 'object') {
          parsed = res.json
        } else if (res.body) {
          try {
            parsed = JSON.parse(new TextDecoder().decode(res.body))
          } catch (err2) {
            parsed = null
          }
        }
        // Parser por empresa: Acuidar = wrapper {status, message, dados}; Dona Help = array direto
        let lista = null
        if (Array.isArray(parsed)) {
          lista = parsed
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.dados)) lista = parsed.dados
          else if (Array.isArray(parsed.data)) lista = parsed.data
          else if (Array.isArray(parsed.unidades)) lista = parsed.unidades
        }
        if (lista) {
          unidades = lista.map((u) => ({
            codigo: String(u.codigo || ''),
            nome: String(u.nome || ''),
            cidade: String(u.cidade || ''),
            estado_uf: String(u.estado || ''),
          }))
          unidadesTimestamp = new Date().toISOString()
        } else {
          unidadesOk = false
        }
      } else {
        unidadesOk = false
      }
    }
  } catch (err) {
    unidadesOk = false
  }

  // RN-1-14: fonte de unidades indisponível → dados_indisponiveis, sem contagem enganosa
  if (!unidadesOk) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'fonte_de_unidades_indisponivel',
      fonte:
        empresa === 'acuidar'
          ? 'Portal Acuidar (API de unidades)'
          : 'Portal Dona Help (API de unidades)',
      empresa: empresa,
      mes: mesAlvo,
      timestamp: new Date().toISOString(),
    })
  }

  // 2. Ocorrências da empresa no mês (banco local — tempo real)
  //    RN-1-17: sem data_fato válida → fora da contagem mensal (não é possível situar no período)
  let ocorrencias = []
  try {
    ocorrencias = $app.findRecordsByFilter(
      'ocorrencias',
      'empresa = {:empresa} && data_fato >= {:ini} && data_fato < {:fim}',
      '-created',
      500,
      0,
      {
        empresa: empresa,
        ini: mesAlvo + '-01 00:00:00.000Z',
        fim:
          mesAlvo === '12'
            ? String(Number(anoStr) + 1) + '-01'
            : anoStr + '-' + String(Number(mesStr) + 1).padStart(2, '0') + '-01',
      },
    )
  } catch (err) {
    return e.json(200, {
      resultado: 'dados_indisponiveis',
      motivo: 'falha_ao_ler_ocorrencias',
      fonte: 'intranet (banco local)',
      empresa: empresa,
      mes: mesAlvo,
      timestamp: new Date().toISOString(),
    })
  }

  // 3. Agregar por unidade × estado
  // Estados da F1-T07 aplicados às ocorrências da intranet (entrada assistida manual):
  //   - confirmado com todos os obrigatórios → ocorrencia_confirmada (RN-1-13)
  //   - confirmado com obrigatório ausente → ocorrencia_incompleta (RN-1-12)
  //   - aguardando_aprovacao_de_excecao / em_revisao / aguardando_correcao / possivel_duplicidade /
  //     falha_de_gravacao / pendente → ocorrencia_pendente (exige ação humana antes de fechar)
  //   - unidade sem ocorrência no mês → reuniao_pendente (RN-1-18)
  const OBRIGATORIOS = [
    'titulo',
    'relato',
    'data_fato',
    'horario',
    'occurrence_type',
    'portal_unit_id',
  ]
  const porUnidade = {}
  for (const u of unidades) {
    porUnidade[u.codigo] = {
      codigo: u.codigo,
      nome: u.nome,
      cidade: u.cidade,
      reuniao_pendente: 0,
      relato_pendente: 0,
      ocorrencia_pendente: 0,
      ocorrencia_incompleta: 0,
      ocorrencia_confirmada: 0,
      total: 0,
      ultima_atualizacao: '',
    }
  }
  const semUnidade = {
    codigo: '(sem unidade válida)',
    nome: 'Ocorrências com unidade não encontrada no cadastro',
    counts: null,
  }

  for (const oc of ocorrencias) {
    const unitId = oc.getString('portal_unit_id')
    const alvo = porUnidade[unitId]
    const destino = alvo || null
    if (!destino) {
      continue // unidade fora do cadastro atual — contabilizada à parte abaixo
    }
    destino.total++
    const upd = oc.getString('updated') || ''
    if (upd > destino.ultima_atualizacao) destino.ultima_atualizacao = upd

    const estado = oc.getString('estado')
    if (estado === 'confirmado') {
      // RN-1-12/13: completude decide entre confirmada e incompleta
      let completa = true
      for (const campo of OBRIGATORIOS) {
        const v = oc.getString(campo)
        if (!v || !v.trim()) {
          completa = false
          break
        }
      }
      if (completa) destino.ocorrencia_confirmada++
      else destino.ocorrencia_incompleta++
    } else {
      // qualquer estado não-confirmado exige decisão/correção humana → pendente
      destino.ocorrencia_pendente++
    }
  }

  // 4. Unidades sem ocorrência no mês → reuniao_pendente (elegibilidade total)
  const linhas = []
  let semRegistroNoMes = 0
  for (const u of unidades) {
    const p = porUnidade[u.codigo]
    if (p.total === 0) {
      p.reuniao_pendente = 1 // unidade ativa sem registro no período
      semRegistroNoMes++
    }
    linhas.push(p)
  }

  // 5. Ocorrências com unidade fora do cadastro (dados para conferência, não inferência)
  const codigos = new Set(unidades.map((u) => u.codigo))
  let foraDoCadastro = 0
  for (const oc of ocorrencias) {
    if (!codigos.has(oc.getString('portal_unit_id'))) foraDoCadastro++
  }

  return e.json(200, {
    resultado: 'ok',
    empresa: empresa,
    mes: mesAlvo,
    gerado_em: new Date().toISOString(),
    total_ocorrencias_no_mes: ocorrencias.length,
    total_unidades: unidades.length,
    unidades_sem_registro_no_mes: semRegistroNoMes,
    ocorrencias_fora_do_cadastro: foraDoCadastro,
    fonte_ocorrencias: 'intranet (banco local) — tempo real',
    fonte_unidades:
      empresa === 'acuidar'
        ? 'Portal Acuidar — atualização diária'
        : 'Portal Dona Help — atualização diária',
    unidades_timestamp: unidadesTimestamp,
    linhas: linhas,
  })
})
