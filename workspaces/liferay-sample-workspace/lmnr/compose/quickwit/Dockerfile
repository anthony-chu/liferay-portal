FROM quickwit/quickwit:v0.9.1

RUN apt-get update && \
	apt-get install --no-install-recommends --yes curl && \
	rm --force --recursive /var/lib/apt/lists/*