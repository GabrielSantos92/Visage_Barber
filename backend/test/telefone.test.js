// Regras de telefone do backend: as mesmas da web e do mobile.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { telefoneParaSalvar, validarTelefone } = require('../src/services/telefone');

test('salva so os digitos, sem mascara, 0 ou 55', () => {
  assert.equal(telefoneParaSalvar('(11) 98765-4321'), '11987654321');
  assert.equal(telefoneParaSalvar('+55 (11) 98765-4321'), '11987654321');
  assert.equal(telefoneParaSalvar('5511987654321'), '11987654321');
  assert.equal(telefoneParaSalvar('011 3333-4444'), '1133334444');
  assert.equal(telefoneParaSalvar(''), '');
  assert.equal(telefoneParaSalvar(undefined), '');
});

test('aceita celular e fixo validos', () => {
  assert.equal(validarTelefone('(11) 98765-4321', { obrigatorio: true }), null);
  assert.equal(validarTelefone('1133334444', { obrigatorio: true }), null);
  assert.equal(validarTelefone('+55 21 99876-5432', { obrigatorio: true }), null);
});

test('recusa vazio quando obrigatorio, incompleto e fora do padrao', () => {
  assert.match(validarTelefone('', { obrigatorio: true }), /obrigatório/);
  assert.equal(validarTelefone(''), null);
  assert.match(validarTelefone('(11) 9876-543'), /incompleto/);
  assert.match(validarTelefone('11887654321'), /Celular/);
  assert.match(validarTelefone('1193334444'), /fixo/);
  assert.match(validarTelefone('1033334444'), /DDD/);
  assert.match(validarTelefone('119876543210'), /dígitos demais/);
});
