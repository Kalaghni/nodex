# Nodex monitor agent — ping / TCP / HTTP checks for Nodex live monitoring
FROM node:24-alpine

# iputils ping supports unprivileged ICMP sockets (Docker grants them via
# net.ipv4.ping_group_range), so the agent doesn't need to run as root
RUN apk add --no-cache iputils

WORKDIR /app
COPY package.json server.js ./

ENV HOST=0.0.0.0 \
    PORT=7070
EXPOSE 7070
USER node

CMD ["node", "server.js"]
