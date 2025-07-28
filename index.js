// Requisitos de bibliotecas
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const csv = require('csv-parser');
const FormData = require('form-data');

// Base URL
const BASE_URL = process.env.BASE_URL;

// Logger auxiliar
function log(message) {
    console.log(`[INFO] ${message}`);
}
function warn(message) {
    console.warn(`[WARN] ${message}`);
}
function error(message) {
    console.error(`[ERROR] ${message}`);
}

// Buscar universidade por nome
async function getInstituicaoID(nomeUniversidade, instituicaoPaiID = null) {
    try {
        const params = {
            Nome: nomeUniversidade,
            PageNumber: 1,
            PageSize: 100
        };
        if (instituicaoPaiID) params.InstituicaoPaiID = instituicaoPaiID;

        const response = await axios.get(`${BASE_URL}/getAllInstituicaoEnsino`, { params });
        const lista = Array.isArray(response.data) ? response.data : response.data.data;
        const found = lista.find(
            (item) => item.nome.trim().toLowerCase() === nomeUniversidade.trim().toLowerCase()
        );
        if (found) log(`ID encontrado para "${nomeUniversidade}": ${found.id}`);
        else warn(`Instituição não encontrada: ${nomeUniversidade}`);
        return found ? found.id : null;
    } catch (err) {
        error(`Erro ao buscar instituição: ${err.message}`);
        return null;
    }
}

// Criar universidade ou faculdade
async function criarInstituicao(payload, isUnidadeOrganica = false) {
    try {
        payload.Foto = '';
        payload.DescricaoEmpresa = '';

        const form = new FormData();
        Object.entries(payload).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                form.append(key, String(value));
            }
        });

        await axios.post(`${BASE_URL}/addInstituicaoEnsino`, form, {
            headers: form.getHeaders(),
        });

        log(`${isUnidadeOrganica ? 'Unidade orgânica' : 'Universidade'} criada: ${payload.Nome}`);
        // Rebuscar ID após criação
        const id = await getInstituicaoID(payload.Nome, payload.InstituicaoPaiID);
        if (!id) {
            error(`Não foi possível recuperar o ID para: ${payload.Nome}`);
        }
        return id;
    } catch (err) {
        error(`Erro ao criar instituição: ${err.response?.data?.retorno?.mensagem || err.message}`);
        return null;
    }
}

// Verificar se curso está associado
async function cursoJaAssociado(instituicaoID, cursoID) {
    try {
        const response = await axios.get(`${BASE_URL}/getAllInstituicaoEnsinoCurso`);
        const lista = Array.isArray(response.data) ? response.data : response.data.data;
        return lista.some(
            (item) => item.instituicaoEnsinoID === instituicaoID && item.cursoID === cursoID
        );
    } catch (err) {
        error(`Erro ao verificar associação de curso: ${err.message}`);
        return false;
    }
}

// Associar curso
async function associarCurso(instituicaoID, cursoID, valorMensalidade = 0) {
    if (!instituicaoID) {
        error(`ID da instituição indefinido. Curso ID ${cursoID} não pôde ser associado.`);
        return;
    }
    const jaExiste = await cursoJaAssociado(instituicaoID, cursoID);
    if (jaExiste) {
        warn(`Curso ID ${cursoID} já está associado à instituição ID ${instituicaoID}`);
        return;
    }
    const body = {
        instituicaoEnsinoID: instituicaoID,
        cursoID: cursoID,
        valorMensalidade: valorMensalidade,
    };
    const response = await axios.post(`${BASE_URL}/AddInstituicaoEnsinoCurso`, body);
    log(`Curso ID ${cursoID} associado à instituição ID ${instituicaoID}`);
    return response.data;
}

function gerarSigla(universidade) {
    if (!universidade) return '';

    const palavras = universidade
        .trim()
        .split(/\s+/)
        .filter(p => !['de', 'da', 'do', 'das', 'dos', 'e'].includes(p.toLowerCase())); // remove preposições

    const sigla = palavras.map(p => p[0]).join('').toUpperCase();

    return sigla;
}

// Criar curso
async function criarCurso(nomeCurso) {
    try {
        const body = {
            designacao: nomeCurso.toUpperCase(),
            sigla: gerarSigla(nomeCurso) || Math.random().toString(36).substring(2, 6).toUpperCase(),
            areaFormacaoID: 1,
            nivelAcademico: 3,
            codigo: Math.random().toString(36).substring(2, 8).toUpperCase(),
            categoriaInstituicaoEnsinoID: 8
        };

        const response = await axios.post(`${BASE_URL}/addCurso`, body);
        log(`Curso criado: ${nomeCurso}`);

        return await getCursoIDPorNome(nomeCurso);
    } catch (err) {
        error(`Erro ao criar curso: ${err.response?.data?.retorno?.mensagem || err.message}`);
        return null;
    }
}

// Buscar ID do curso
async function getCursoIDPorNome(nomeCurso) {
    try {
        const response = await axios.get(`${BASE_URL}/getAllCurso`, {
            params: {
                Designacao: nomeCurso,
                PageNumber: 1,
                PageSize: 100
            }
        });
        const lista = Array.isArray(response.data) ? response.data : response.data.data;
        const found = lista.find(
            (item) => item.designacao.trim().toLowerCase() === nomeCurso.trim().toLowerCase()
        );
        if (found) log(`Curso encontrado: ${found.designacao} (ID: ${found.id})`);
        else warn(`Curso não encontrado: ${nomeCurso}`);
        return found ? found.id : null;
    } catch (err) {
        error(`Erro ao buscar curso: ${err.message}`);
        return null;
    }
}

// Fluxo com CSV
async function processarCSV(caminhoCsv) {
    const linhas = [];
    fs.createReadStream(caminhoCsv)
        .pipe(csv())
        .on('data', (row) => linhas.push(row))
        .on('end', async () => {
            for (const linha of linhas) {
                const universidade = linha["Universidade / Instituto"].trim();
                const faculdade = linha["Faculdade / Unidade Orgânica"].trim();
                const curso = linha["Curso"].trim();

                if (!universidade || !faculdade || !curso || faculdade === '—') continue;

                try {
                    let universidadeID = await getInstituicaoID(universidade);

                    if (!universidadeID) {
                        const payloadUni = {
                            Nome: universidade.toUpperCase(),
                            Sigla: gerarSigla(universidade) || universidade.substring(0, 5).toUpperCase(),
                            NumIdentificacao: Math.random().toString(36).substring(2, 10).toUpperCase(),
                            ProvinciaID: 3,
                            MunicipioID: 2607,
                            Endereco: 'ENDERECO GENÉRICO',
                            Telefone: '923000000',
                            Email: `${universidade.replace(/\s+/g, '').toLowerCase()}@example.ao`,
                            TipoInstituicao: 1,
                            Natureza: 1,
                            IsActive: true,
                        };
                        universidadeID = await criarInstituicao(payloadUni, false);
                    }

                    let unidadeID = await getInstituicaoID(faculdade, universidadeID);

                    if (!unidadeID) {
                        let universidadeID = await getInstituicaoID(universidade);
                        console.log(`Criando unidade orgânica para: ${faculdade} sob a universidade ID ${universidadeID}`);
                        const payloadFaculdade = {
                            Nome: faculdade.toUpperCase(),
                            Sigla: gerarSigla(faculdade) || faculdade.substring(0, 5).toUpperCase(),
                            NumIdentificacao: Math.random().toString(36).substring(2, 10).toUpperCase(),
                            ProvinciaID: 3,
                            MunicipioID: 2607,
                            Endereco: 'ENDERECO GENÉRICO',
                            Telefone: '923000000',
                            Email: `${faculdade.replace(/\s+/g, '').toLowerCase()}@example.ao`,
                            TipoInstituicao: 1,
                            Natureza: 1,
                            IsActive: true,
                            InstituicaoPaiID: universidadeID,
                        };
                        unidadeID = await criarInstituicao(payloadFaculdade, true);
                    }

                    unidadeID = await getInstituicaoID(faculdade, universidadeID);

                    if (!unidadeID) {
                        error(`Unidade orgânica não encontrada nem criada: ${faculdade}`);
                        continue;
                    }

                    let cursoID = await getCursoIDPorNome(curso);
                    if (!cursoID) {
                        cursoID = await criarCurso(curso);
                        cursoID = await getCursoIDPorNome(curso);
                        if (!cursoID) continue;
                    }

                    await associarCurso(unidadeID, cursoID);
                } catch (err) {
                    error(`Erro ao processar linha: ${err.message}`);
                }
            }
        });
}

// Chamada do processamento
(async () => {
    await processarCSV('Tabela_Final_com_Pesquisa.csv');
})();
