FROM rasa/rasa:3.6.21

WORKDIR /app
COPY . /app

USER root
RUN rasa train
USER 1001

EXPOSE 5005
CMD ["sh", "-c", "rasa run --enable-api --cors '*' --host 0.0.0.0 --port ${PORT:-5005} --endpoints endpoints.cloud.yml"]
