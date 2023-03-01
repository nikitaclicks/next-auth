import { randomBytes } from "crypto"
import { TableClient } from "@azure/data-tables"
import {
  Account,
  AccountByUserId,
  keys,
  Session,
  SessionByUserId,
  UserById,
  VerificationToken,
} from "./types"

export const TableStorageAdapter = (client: TableClient) => {
  return {
    async createUser(user: any) {
      user.id = randomBytes(16).toString("hex")

      await Promise.all([
        client.createEntity({
          ...user,
          partitionKey: keys.user,
          rowKey: user.email,
        }),
        client.createEntity({
          partitionKey: keys.userById,
          rowKey: user.id,
          email: user.email,
        }),
      ])

      return withoutKeys(user)
    },
    async getUser(id: string) {
      try {
        const { email } = await client.getEntity<UserById>(keys.userById, id)
        const user = await client.getEntity(keys.user, email)

        return withoutKeys(user)
      } catch {
        return null
      }
    },
    async getUserByEmail(email: string) {
      try {
        const user = await client.getEntity(keys.user, email)
        return withoutKeys(user)
      } catch {
        return null
      }
    },
    async getUserByAccount({ providerAccountId, provider } : any) {
      try {
        const rowKey = `${providerAccountId}_${provider}`

        const account = await client.getEntity<Account>(keys.account, rowKey)
        const userById = await client.getEntity<UserById>(
          keys.userById,
          account.userId
        )
        const user = await client.getEntity(keys.user, userById.email)

        return withoutKeys(user)
      } catch {
        return null
      }
    },
    async updateUser(user: any) {
      let email = user.email
      if (!email) {
        const userById = await client.getEntity<UserById>(
          keys.userById,
          user.id
        )
        email = userById.email
      }

      const updatedUser = { ...user, partitionKey: keys.user, rowKey: email }
      await client.updateEntity(updatedUser, "Merge")

      return user
    },
    async deleteUser(userId: string) {
      try {
        const { email } = await client.getEntity<UserById>(
          keys.userById,
          userId
        )
        const user = await client.getEntity(keys.user, email)
        const { sessionToken } = await client.getEntity<SessionByUserId>(
          keys.sessionByUserId,
          userId
        )
        const accounts = withoutKeys(
          await client.getEntity<AccountByUserId>(keys.accountByUserId, userId)
        )

        const deleteAccounts = Object.keys(accounts).map((property) =>
          client.deleteEntity(keys.account, `${accounts[property]}_${property}`)
        )

        await Promise.all([
          client.deleteEntity(keys.user, email),
          client.deleteEntity(keys.userById, userId),
          client.deleteEntity(keys.session, sessionToken),
          client.deleteEntity(keys.sessionByUserId, userId),
          ...deleteAccounts,
          client.deleteEntity(keys.accountByUserId, userId),
        ])

        return withoutKeys(user)
      } catch {
        return null
      }
    },
    async linkAccount(account: any) {
      try {
        await client.createEntity({
          ...account,
          partitionKey: keys.account,
          rowKey: `${account.providerAccountId}_${account.provider}`,
        })
        await client.upsertEntity({
          partitionKey: keys.accountByUserId,
          rowKey: account.userId,
          [account.provider]: account.providerAccountId,
        })

        return account
      } catch {
        return null
      }
    },
    async unlinkAccount({ providerAccountId, provider } : any) {
      try {
        const rowKey = `${providerAccountId}_${provider}`
        const account = await client.getEntity<Account>(keys.account, rowKey)

        await client.deleteEntity(keys.account, rowKey)
        await client.deleteEntity(keys.accountByUserId, account.userId)

        return withoutKeys(account)
      } catch {
        return null
      }
    },
    async createSession(session: any) {
      await client.createEntity({
        ...session,
        partitionKey: keys.session,
        rowKey: session.sessionToken,
      })
      await client.upsertEntity({
        partitionKey: keys.sessionByUserId,
        rowKey: session.userId,
        sessionToken: session.sessionToken,
      })

      return withoutKeys(session)
    },
    async getSessionAndUser(sessionToken: any) {
      try {
        const session = await client.getEntity<Session>(
          keys.session,
          sessionToken
        )

        if (session.expires.valueOf() < Date.now()) {
          await client.deleteEntity(keys.session, sessionToken)
        }

        const userById = await client.getEntity<UserById>(
          keys.userById,
          session.userId
        )
        const user = await client.getEntity(keys.user, userById.email)

        return {
          session: withoutKeys(session),
          user: withoutKeys(user),
        }
      } catch {
        return null
      }
    },
    async updateSession(session: any) {
      try {
        await client.updateEntity({
          ...session,
          partitionKey: keys.session,
          rowKey: session.sessionToken,
        })

        return withoutKeys(session)
      } catch {
        return null
      }
    },
    async deleteSession(sessionToken: any) {
      try {
        const session = await client.getEntity<Session>(
          keys.session,
          sessionToken
        )

        await Promise.all([
          client.deleteEntity(keys.session, sessionToken),
          client.deleteEntity(keys.sessionByUserId, session.userId),
        ])

        return withoutKeys(session)
      } catch {
        return null
      }
    },
    async createVerificationToken(token: any) {
      await client.createEntity({
        ...token,
        partitionKey: keys.verificationToken,
        rowKey: token.token,
      })

      return token
    },
    async useVerificationToken({ identifier, token } : any) {
      try {
        const tokenEntity = await client.getEntity<VerificationToken>(
          keys.verificationToken,
          token
        )

        if (tokenEntity.identifier !== identifier) {
          return null
        }

        await client.deleteEntity(keys.verificationToken, token)

        return withoutKeys(tokenEntity)
      } catch {
        return null
      }
    },
  }

  function withoutKeys(entity: any) {
    delete entity.partitionKey
    delete entity.rowKey
    delete entity.etag
    delete entity.timestamp
    delete entity["odata.metadata"]

    return entity
  }
}
