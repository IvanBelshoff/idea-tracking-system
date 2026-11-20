import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDocs,
  curlOf,
  describe as describeNode,
  exampleOf,
  fieldsOf,
  TOKEN_PLACEHOLDER,
  typeLabel,
} from './docs-model.ts';

const doc = {
  openapi: '3.0.0',
  servers: [{ url: 'https://its.empresa.com.br/' }],
  paths: {
    '/integration/v1/users': {
      get: {
        tags: ['users'],
        summary: 'List users',
        description: 'People with a role.',
        'x-description-pt-BR': 'Pessoas com perfil.',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer' },
            description: 'Items per page.',
            'x-description-pt-BR': 'Itens por página.',
          },
        ],
        responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/UserPage' } } } } },
      },
    },
    '/integration/v1/ideas/{code}': {
      get: {
        tags: ['ideas'],
        summary: 'Get an idea',
        description: 'One idea.',
        parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' }, description: 'Code.' }],
        responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/IdeaItem' } } } } },
      },
    },
    '/integration/v1/openapi.json': {
      get: {
        tags: ['contract'],
        summary: 'Contract',
        description: 'The contract.',
        responses: { 200: { description: 'ok' } },
      },
    },
  },
  components: {
    schemas: {
      UserPage: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/UserItem' } },
          next_cursor: { type: 'string', nullable: true, example: null, description: 'Next.' },
        },
      },
      UserItem: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            example: 'Maria Souza',
            description: 'Display name.',
            'x-description-pt-BR': 'Nome de exibição.',
          },
          email: { type: 'string', example: 'maria@empresa.com.br', description: 'E-mail.' },
          links: { type: 'array', items: { $ref: '#/components/schemas/Link' }, description: 'Roles.' },
        },
      },
      Link: { type: 'object', properties: { role: { type: 'string', example: 'Analista', description: 'Role.' } } },
      IdeaItem: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'ITS-2026-0042', description: 'Code.' },
          status: { enum: ['submitted', 'implemented'], type: 'string', description: 'Situation.' },
        },
      },
    },
  },
};

describe('Documentação das integrações (CA-RN-115.8, CA-RN-115.9, CA-RN-115.11)', () => {
  it('CA-RN-115.8 agrupa por módulo, na ordem do contrato, com o endereço do sistema', () => {
    const docs = buildDocs(doc, 'en');
    assert.deepEqual(
      docs.modules.map((m) => m.id),
      ['ideas', 'users', 'contract'],
    );
    assert.equal(docs.baseUrl, 'https://its.empresa.com.br/');
  });

  it('CA-RN-115.8 cada rota traz parâmetros, campos do item, exemplo e curl', () => {
    const users = buildDocs(doc, 'en').modules.find((m) => m.id === 'users')?.routes[0];
    assert.ok(users);
    assert.equal(users.method, 'GET');
    assert.deepEqual(
      users.params.map((p) => [p.name, p.place, p.required, p.type]),
      [['limit', 'query', false, 'integer']],
    );
    assert.deepEqual(
      users.fields.map((f) => f.name),
      ['name', 'email', 'links'],
    );
    assert.deepEqual(
      users.fields.find((f) => f.name === 'links')?.children.map((f) => f.name),
      ['role'],
    );
    assert.deepEqual(users.example, {
      data: [{ name: 'Maria Souza', email: 'maria@empresa.com.br', links: [{ role: 'Analista' }] }],
      next_cursor: null,
    });
    assert.match(
      users.curl,
      /^curl -H "Authorization: Bearer SEU_TOKEN" "https:\/\/its\.empresa\.com\.br\/integration\/v1\/users\?limit=50"$/,
    );
  });

  it('CA-RN-115.9 o curl usa só o marcador e a rota com parâmetro de caminho ganha um código de exemplo', () => {
    const idea = buildDocs(doc, 'en').modules.find((m) => m.id === 'ideas')?.routes[0];
    assert.ok(idea);
    assert.equal(
      idea.curl,
      `curl -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}" "https://its.empresa.com.br/integration/v1/ideas/ITS-2026-0042"`,
    );
    for (const route of buildDocs(doc, 'en').modules.flatMap((m) => m.routes)) {
      assert.doesNotMatch(route.curl, /its_[A-Za-z0-9_-]{20,}/);
    }
  });

  it('CA-RN-115.11 a descrição vem no idioma da pessoa; sem tradução, a em inglês', () => {
    assert.equal(describeNode({ description: 'E', 'x-description-pt-BR': 'P' }, 'pt-BR'), 'P');
    assert.equal(describeNode({ description: 'E', 'x-description-pt-BR': 'P' }, 'en'), 'E');
    assert.equal(describeNode({ description: 'E' }, 'pt-BR'), 'E');
    const users = buildDocs(doc, 'pt-BR').modules.find((m) => m.id === 'users')?.routes[0];
    assert.equal(users?.description, 'Pessoas com perfil.');
    assert.equal(users?.params[0]?.description, 'Itens por página.');
    assert.equal(users?.fields[0]?.description, 'Nome de exibição.');
    assert.equal(users?.params[0]?.type, 'inteiro');
  });

  it('o tipo mostra formato, lista e valores possíveis; o exemplo cai num valor neutro sem `example`', () => {
    const d = doc as unknown as Record<string, unknown>;
    assert.equal(typeLabel(d, { type: 'string', format: 'date-time' }, 'en'), 'string (date-time)');
    assert.equal(typeLabel(d, { type: 'array', items: { type: 'integer' } }, 'pt-BR'), 'lista de inteiro');
    assert.equal(typeLabel(d, { type: 'string', enum: ['a', 'b'] }, 'en'), '"a" | "b"');
    assert.equal(exampleOf(d, { type: 'integer' }), 0);
    assert.equal(exampleOf(d, { type: 'string', format: 'date' }), '2026-11-11');
    assert.deepEqual(exampleOf(d, { type: 'array', items: { type: 'boolean' } }), [false]);
    assert.deepEqual(fieldsOf(d, { type: 'object', properties: {} }, 'en'), []);
  });

  it('CA-RN-115.8 campo que aponta para outro esquema (allOf) é objeto, com exemplo e filhos; parâmetro sem esquema é string', () => {
    const d = {
      ...doc,
      paths: {
        '/integration/v1/x': {
          get: {
            tags: ['ideas'],
            parameters: [{ name: 'entity_id', in: 'query', required: false, schema: {}, description: 'Entity.' }],
            responses: {
              200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Holder' } } } },
            },
          },
        },
      },
      components: {
        schemas: {
          Holder: {
            type: 'object',
            properties: { entity: { description: 'Entity.', allOf: [{ $ref: '#/components/schemas/Ref' }] } },
          },
          Ref: { type: 'object', properties: { id: { type: 'string', example: 'abc', description: 'Id.' } } },
        },
      },
    };
    const route = buildDocs(d, 'pt-BR').modules[0]?.routes[0];
    assert.equal(route?.params[0]?.type, 'string');
    assert.equal(route?.fields[0]?.type, 'objeto');
    assert.deepEqual(
      route?.fields[0]?.children.map((f) => f.name),
      ['id'],
    );
    assert.deepEqual(route?.example, { entity: { id: 'abc' } });
  });

  it('sem endereço do sistema o exemplo usa um endereço de mentira', () => {
    const noServer = { ...doc, servers: undefined };
    assert.equal(buildDocs(noServer, 'en').baseUrl, 'https://seu-endereco-do-its');
    assert.equal(
      curlOf('https://x.example/', '/integration/v1/ideas', []),
      'curl -H "Authorization: Bearer SEU_TOKEN" "https://x.example/integration/v1/ideas"',
    );
  });

  it('CA-RN-134.2 rota de escrita: corpo com campos e exemplo, Idempotency-Key e curl com método, chave e corpo de exemplo', () => {
    const write = {
      openapi: '3.0.0',
      servers: [{ url: 'https://its.empresa.com.br' }],
      paths: {
        '/integration/v1/ideas/{code}/comments': {
          post: {
            tags: ['ideas_write'],
            summary: 'Comment on an idea',
            description: 'Adds a comment.',
            'x-description-pt-BR': 'Acrescenta um comentário.',
            parameters: [
              { name: 'code', in: 'path', required: true, description: 'Id.' },
              {
                name: 'Idempotency-Key',
                in: 'header',
                required: true,
                schema: { type: 'string' },
                description: 'Key.',
                'x-description-pt-BR': 'Chave.',
              },
            ],
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/CommentBody' } } },
            },
            responses: {
              201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CommentDone' } } } },
            },
          },
        },
        '/integration/v1/openapi.json': { get: { tags: ['contract'], summary: 'Contract', responses: {} } },
        '/integration/v1/ideas': { get: { tags: ['ideas'], summary: 'List', responses: {} } },
      },
      components: {
        schemas: {
          CommentBody: {
            type: 'object',
            properties: {
              body: {
                type: 'string',
                example: "Chamado d'água atendido.",
                description: 'Text.',
                'x-description-pt-BR': 'Texto.',
              },
            },
          },
          CommentDone: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid', example: '0b6f1c1e-7c1e-4b0a-9a53-5f6c2f0e8d11' } },
          },
        },
      },
    };
    const docs = buildDocs(write, 'pt-BR');
    // A escrita vem depois da leitura e antes do contrato.
    assert.deepEqual(
      docs.modules.map((m) => m.id),
      ['ideas', 'ideas_write', 'contract'],
    );
    const route = docs.modules.find((m) => m.id === 'ideas_write')?.routes[0];
    assert.equal(route?.method, 'POST');
    assert.deepEqual(
      route?.body?.fields.map((f) => [f.name, f.description]),
      [['body', 'Texto.']],
    );
    assert.deepEqual(route?.body?.example, { body: "Chamado d'água atendido." });
    assert.deepEqual(route?.example, { id: '0b6f1c1e-7c1e-4b0a-9a53-5f6c2f0e8d11' });
    assert.ok(route?.params.some((p) => p.place === 'header' && p.name === 'Idempotency-Key' && p.required));
    const curl = route?.curl ?? '';
    assert.match(curl, /^curl -X POST/);
    assert.ok(curl.includes('Authorization: Bearer SEU_TOKEN'));
    assert.ok(curl.includes('Idempotency-Key: UMA-CHAVE-UNICA-123'));
    assert.ok(curl.includes('/integration/v1/ideas/ITS-2026-0042/comments'));
    // A aspa simples do corpo é protegida para o shell.
    assert.ok(curl.includes("Chamado d'\\''água atendido."));
    // A rota de leitura segue sem corpo.
    assert.equal(docs.modules.find((m) => m.id === 'ideas')?.routes[0]?.body, null);
  });
});
