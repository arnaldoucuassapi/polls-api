import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { randomUUID } from "node:crypto";
import { redis } from "../lib/redis";
import { voting } from "../utils/voting-pub-sub";

export async function voteOnPoll(app: FastifyInstance) {
  app.post("/polls/:pollId/votes", async (request, reply) => {
    const voteOnPollParams = z.object({
      pollId: z.string().uuid()
    })

    const voteOnPollBody = z.object({
      pollOptionId: z.string().uuid()
    })
  
    const { pollId } = voteOnPollParams.parse(request.params);
    const { pollOptionId } = voteOnPollBody.parse(request.body);

    let { sectionId } = request.cookies

    const opt = await prisma.pollOption.findUnique({
      where: {
        id: pollOptionId,
        pollId
      }
    })

    if (!opt) {
      return reply.status(400).send({ message: "This option is unknown." })
    }

    if (sectionId) {
      const userPreviousVoteOnPoll = await prisma.vote.findUnique({
        where: {
          sectionId_pollId: {
            sectionId,
            pollId
          }
        }
      }) 

      if (userPreviousVoteOnPoll && userPreviousVoteOnPoll.pollOptionId != pollOptionId) {
        await prisma.vote.delete({
          where: {
            id: userPreviousVoteOnPoll.id
          }
        })

        const votes = await redis.zincrby(pollId, -1, userPreviousVoteOnPoll.pollOptionId);

        voting.publish(pollId, {
          pollOptionId: userPreviousVoteOnPoll.pollOptionId,
          votes: Number(votes)
        })
      } else if (userPreviousVoteOnPoll) {
        return reply.status(400).send({ message: "You already voted on this poll." })
      }
    }

    if (!sectionId) {
      sectionId = randomUUID()
      
      reply.setCookie("sectionId", sectionId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        signed: true,
        httpOnly: true
      })
    }

    await prisma.vote.create({
      data: {
        pollId,
        sectionId,
        pollOptionId
      }
    })

    const votes = await redis.zincrby(pollId, 1, pollOptionId);

    voting.publish(pollId, {
      pollOptionId,
      votes: Number(votes)
    })

    return reply.status(201).send()
  })
}