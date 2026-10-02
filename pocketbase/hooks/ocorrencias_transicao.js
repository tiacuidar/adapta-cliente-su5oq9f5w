// LT-1-T03 — Transição de estado com validação de perfil e trilha auditável
// Máquina de estados da SPEC-1-002 + matriz F1-T04 + política F1-T05:
//   - consultor: corrige rascunho (aguardando_correcao -> em_revisao), edita estados normais;
//     NUNCA toca aguardando_aprovacao_de_excecao (RLS nega — 404)
//   - gestor/admin: aprova exceção (-> confirmado) ou rejeita (-> aguardando_correcao), com motivo
//   - aprovador ≠ solicitante (CA-1-07): quem criou não aprova a própria exceção
//   - ninguém exclui; confirmado não volta a pendente; trilha: aprovador_por + motivo
// RLS da collection (0003) continua valendo — este hook é camada extra de validação de negócio.
// NOTA JSVM: toda a lógica fica inline no callback (sem constantes top-level).

routerAdd('POST', '/backend/v1/ocorrencias/transicao', (e) => {
  const auth = e.auth
  if (!auth || !auth.id) {
    return e.json(401, { resultado: 'erro', mensagem: 'Autenticação obrigatória.' })
  }

  // Máquina de estados inline (JSVM não acessa declarações top-level no callback)
  const TRANSICOES = {
    pendente: ['em_revisao', 'aguardando_correcao'],
    em_revisao: [
      'aguardando_correcao',
      'aguardando_aprovacao_de_excecao',
      'confirmado',
      'possivel_duplicidade',
      'falha_de_gravacao',
    ],
    aguardando_correcao: ['em_revisao', 'aguardando_aprovacao_de_excecao'],
    aguardando_aprovacao_de_excecao: ['confirmado', 'aguardando_correcao'],
    possivel_duplicidade: ['em_revisao', 'confirmado', 'falha_de_gravacao'],
    falha_de_gravacao: ['em_revisao', 'confirmado'],
    confirmado: [],
  }

  const body = e.requestInfo().body || {}
  const id = String(body.id || '')
  const novoEstado = String(body.estado || '')
  const motivo = String(body.motivo || '').trim()
  const role = String(auth.role || 'consultor')

  if (!id || !novoEstado) {
    return e.json(200, { resultado: 'erro', mensagem: 'id e estado são obrigatórios.' })
  }

  let rec
  try {
    rec = $app.findRecordById('ocorrencias', id)
  } catch (err) {
    return e.json(404, { resultado: 'erro', mensagem: 'Ocorrência não encontrada.' })
  }

  const estadoAtual = rec.getString('estado')

  // Consultor nunca toca registro em aguardando_aprovacao (defesa em profundidade — a RLS já nega)
  if (estadoAtual === 'aguardando_aprovacao_de_excecao' && role === 'consultor') {
    return e.json(404, { resultado: 'erro', mensagem: 'Ocorrência não encontrada.' })
  }

  // Transição válida?
  const permitidas = TRANSICOES[estadoAtual] || []
  if (!permitidas.includes(novoEstado)) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Transição inválida: ' + estadoAtual + ' → ' + novoEstado + '.',
      estado_atual: estadoAtual,
    })
  }

  // Aprovação/rejeição de exceção exige gestor ou administrador
  if (estadoAtual === 'aguardando_aprovacao_de_excecao' && role === 'consultor') {
    return e.json(403, {
      resultado: 'erro',
      mensagem: 'Perfil sem permissão para aprovar exceção.',
    })
  }

  // CA-1-07: aprovador ≠ solicitante — quem criou não aprova a própria exceção
  if (estadoAtual === 'aguardando_aprovacao_de_excecao') {
    const criadoPor = rec.getString('criado_por')
    if (criadoPor && criadoPor === auth.id) {
      return e.json(200, {
        resultado: 'erro',
        mensagem: 'O solicitante não pode aprovar a própria exceção (política F1-T05).',
      })
    }
    if (!motivo) {
      return e.json(200, {
        resultado: 'erro',
        mensagem: 'Motivo obrigatório para aprovar ou rejeitar uma exceção.',
      })
    }
  }

  // Mudança de estado exige motivo quando sai de aguardando_* (auditoria)
  if (
    !motivo &&
    (estadoAtual === 'aguardando_aprovacao_de_excecao' ||
      estadoAtual === 'possivel_duplicidade' ||
      estadoAtual === 'falha_de_gravacao')
  ) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Motivo obrigatório para decidir sobre este estado.',
    })
  }

  // Aplicar transição com trilha
  rec.set('estado', novoEstado)
  if (motivo) {
    const motivoAnterior = rec.getString('motivo') || ''
    const trilha = '[' + new Date().toISOString() + '] ' + auth.id + ' (' + role + '): ' + motivo
    rec.set('motivo', motivoAnterior ? motivoAnterior + ' | ' + trilha : trilha)
  }
  if (estadoAtual === 'aguardando_aprovacao_de_excecao') {
    rec.set('aprovador_por', auth.id)
  }
  try {
    $app.save(rec)
  } catch (err) {
    return e.json(200, {
      resultado: 'erro',
      mensagem: 'Falha ao gravar a transição. Estado permanece ' + estadoAtual + '.',
    })
  }

  return e.json(200, {
    resultado: 'ok',
    id: rec.id,
    estado_anterior: estadoAtual,
    estado: novoEstado,
    decidido_por: auth.id,
    papel: role,
  })
})
