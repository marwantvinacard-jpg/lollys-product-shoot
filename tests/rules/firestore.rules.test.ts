// Real Firestore security rules tests against the Firestore emulator --
// these actually parse and execute firestore.rules, unlike the rest of the
// suite (which deliberately avoids anything touching services/firebase.ts).
// This is what would have caught the original `allow read, write: if true`
// catch-all: it directly proves the rules behave as intended, not just that
// the file happens to compile.
//
// NOT run by `npm test` -- needs the Firestore emulator (and therefore a
// JRE) running. Run with:
//   npm run test:rules
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, addDoc, collection, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-lollys-rules-test',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('lollys_api_usage_history', () => {
  it('denies an unauthenticated client entirely', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, 'lollys_api_usage_history')));
    await assertFails(addDoc(collection(db, 'lollys_api_usage_history'), { model: 'x' }));
  });

  it('lets a signed-in user create and read records', async () => {
    const db = testEnv.authenticatedContext('user1').firestore();
    const ref = await assertSucceeds(addDoc(collection(db, 'lollys_api_usage_history'), { model: 'x' }));
    await assertSucceeds(getDoc(ref));
  });

  it('never allows update or delete, even when signed in', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'lollys_api_usage_history/seed'), { model: 'x' });
    });
    const db = testEnv.authenticatedContext('user1').firestore();
    await assertFails(updateDoc(doc(db, 'lollys_api_usage_history/seed'), { model: 'y' }));
    await assertFails(deleteDoc(doc(db, 'lollys_api_usage_history/seed')));
  });
});

describe('support_tickets', () => {
  it("lets a user file their own ticket but not one claiming to be someone else's", async () => {
    const db = testEnv.authenticatedContext('user1').firestore();
    await assertSucceeds(addDoc(collection(db, 'support_tickets'), { uid: 'user1', message: 'help' }));
    await assertFails(addDoc(collection(db, 'support_tickets'), { uid: 'someone-else', message: 'help' }));
  });

  it("denies reading another user's ticket", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'support_tickets/t1'), { uid: 'user2', message: 'hi' });
    });
    const db = testEnv.authenticatedContext('user1').firestore();
    await assertFails(getDoc(doc(db, 'support_tickets/t1')));
  });
});

describe('billing', () => {
  it('lets a user read only their own balance, and never write it directly', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'billing/user1'), { credits: 100 });
    });
    const ownDb = testEnv.authenticatedContext('user1').firestore();
    await assertSucceeds(getDoc(doc(ownDb, 'billing/user1')));
    await assertFails(updateDoc(doc(ownDb, 'billing/user1'), { credits: 999999 }));

    const otherDb = testEnv.authenticatedContext('user2').firestore();
    await assertFails(getDoc(doc(otherDb, 'billing/user1')));
  });
});

describe('client_errors', () => {
  it('accepts an error report from anyone, even signed out, but never returns one', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(addDoc(collection(db, 'client_errors'), { message: 'boom' }));
    await assertFails(getDocs(collection(db, 'client_errors')));
  });
});

describe('everything else', () => {
  it('is closed to any client, signed in or not -- this is the regression test for the original vulnerability', async () => {
    const signedIn = testEnv.authenticatedContext('user1').firestore();
    const signedOut = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(signedIn, 'some_future_collection/doc1'), { hello: 'world' }));
    await assertFails(setDoc(doc(signedOut, 'some_future_collection/doc1'), { hello: 'world' }));
    await assertFails(getDocs(collection(signedIn, 'some_future_collection')));
  });
});
