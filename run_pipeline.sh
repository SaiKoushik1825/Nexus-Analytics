#!/bin/bash
set -e

WORKSPACE_DIR="$(pwd)"

echo "Checking dependencies..."

# 1. Download OpenJDK 17 if java is not available
if ! command -v java &> /dev/null; then
    echo "Java not found. Downloading OpenJDK 17..."
    if [ ! -d "jdk" ]; then
        wget -q --show-progress -O jdk.tar.gz "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.10%2B7/OpenJDK17U-jdk_x64_linux_hotspot_17.0.10_7.tar.gz"
        mkdir jdk
        tar -xzf jdk.tar.gz -C jdk --strip-components=1
        rm jdk.tar.gz
    fi
    export JAVA_HOME="$WORKSPACE_DIR/jdk"
    export PATH="$JAVA_HOME/bin:$PATH"
fi

# 2. Download Kafka
if [ ! -d "kafka" ]; then
    echo "Downloading Kafka..."
    wget -q --show-progress -O kafka.tgz "https://archive.apache.org/dist/kafka/3.6.1/kafka_2.13-3.6.1.tgz"
    mkdir kafka
    tar -xzf kafka.tgz -C kafka --strip-components=1
    rm kafka.tgz
fi

# 3. Download sbt
if [ ! -d "sbt" ]; then
    echo "Downloading SBT..."
    wget -q --show-progress -O sbt.tgz "https://github.com/sbt/sbt/releases/download/v1.9.8/sbt-1.9.8.tgz"
    tar -xzf sbt.tgz
    rm sbt.tgz
fi

export PATH="$WORKSPACE_DIR/sbt/bin:$PATH"

echo "Starting local Kafka & Zookeeper..."
rm -rf /tmp/zookeeper /tmp/kafka-logs
# Start Zookeeper in background
./kafka/bin/zookeeper-server-start.sh ./kafka/config/zookeeper.properties > zookeeper.log 2>&1 &
ZK_PID=$!
sleep 5

# Start Kafka in background
./kafka/bin/kafka-server-start.sh ./kafka/config/server.properties > kafka.log 2>&1 &
KAFKA_PID=$!
sleep 5

echo "Creating Kafka topic..."
./kafka/bin/kafka-topics.sh --create --topic social_interactions --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1 --if-not-exists

echo "Compiling project..."
sbt compile

echo "Starting API server (port 5000)..."
python3 api_server.py &
API_PID=$!
sleep 1

echo "Starting Producer in background..."
sbt "runMain com.socialgraph.ProducerApp" > producer.log 2>&1 &
PRODUCER_PID=$!

echo "Starting Spark GraphX Application..."
sbt "runMain com.socialgraph.SocialGraphApp"

echo "Stopping services..."
kill $PRODUCER_PID 2>/dev/null || true
kill $API_PID 2>/dev/null || true
kill $KAFKA_PID 2>/dev/null || true
kill $ZK_PID 2>/dev/null || true
