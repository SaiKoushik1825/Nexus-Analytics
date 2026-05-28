package com.socialgraph

import java.util.Properties
import org.apache.kafka.clients.producer.{KafkaProducer, ProducerRecord, ProducerConfig}
import scala.util.Random

object ProducerApp {
  def main(args: Array[String]): Unit = {
    val props = new Properties()
    props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092")
    props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringSerializer")
    props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, "org.apache.kafka.common.serialization.StringSerializer")

    var producer: KafkaProducer[String, String] = null
    var connected = false

    println("Connecting to Kafka at localhost:9092...")
    while (!connected) {
      try {
        producer = new KafkaProducer[String, String](props)
        connected = true
      } catch {
        case e: Exception =>
          println("Kafka not ready, waiting...")
          Thread.sleep(2000)
      }
    }

    println("Connected! Starting to produce messages...")
    val random = new Random()
    val interactionTypes = Array("like", "follow", "comment", "share", "post_mention")
    val topic = "social_interactions"

    try {
      while (true) {
        // Simulate power-law distribution for users
        val source = (Math.log(1 - random.nextDouble()) / -0.01).toInt + 1
        var target = (Math.log(1 - random.nextDouble()) / -0.02).toInt + 1
        while (source == target) {
          target = (Math.log(1 - random.nextDouble()) / -0.02).toInt + 1
        }

        val interactionType = interactionTypes(random.nextInt(interactionTypes.length))
        val timestamp = System.currentTimeMillis()

        val json = s"""{"source_user_id":$source,"target_user_id":$target,"interaction_type":"$interactionType","timestamp":$timestamp}"""

        val record = new ProducerRecord[String, String](topic, null, json)
        producer.send(record)
        println(s"Sent: $json")

        Thread.sleep(random.nextInt(400) + 100) // 100ms to 500ms
      }
    } finally {
      producer.close()
    }
  }
}
