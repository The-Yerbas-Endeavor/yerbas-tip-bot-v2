import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig returns normalized values', () => {
  const config = loadConfig({
    DISCORD_TOKEN: ' token ',
    DISCORD_CLIENT_ID: ' client ',
    DISCORD_GUILD_ID: ' guild '
  });

  assert.equal(config.discordToken, 'token');
  assert.equal(config.discordClientId, 'client');
  assert.equal(config.discordGuildId, 'guild');
});

test('loadConfig rejects missing required values', () => {
  assert.throws(
    () => loadConfig({ DISCORD_TOKEN: '' }),
    /DISCORD_TOKEN, DISCORD_CLIENT_ID/
  );
});
