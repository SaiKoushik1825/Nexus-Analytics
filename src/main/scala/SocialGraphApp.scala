package com.socialgraph

import org.apache.spark.sql.SparkSession
import org.apache.spark.sql.functions._
import org.apache.spark.sql.types._
import org.apache.spark.sql.Row
import org.apache.spark.graphx._
import org.apache.spark.rdd.RDD
import java.io.{File, PrintWriter}
import scala.collection.mutable

object SocialGraphApp {
  def main(args: Array[String]): Unit = {
    val spark = SparkSession.builder
      .appName("SocialGraphAnalytics")
      .master("local[*]")
      .getOrCreate()

    import spark.implicits._
    spark.sparkContext.setLogLevel("WARN")

    val kafkaBrokers = "localhost:9092"
    val topic = "social_interactions"

    val interactionSchema = new StructType()
      .add("source_user_id", LongType)
      .add("target_user_id", LongType)
      .add("interaction_type", StringType)
      .add("timestamp", LongType)

    val df = spark.readStream
      .format("kafka")
      .option("kafka.bootstrap.servers", kafkaBrokers)
      .option("subscribe", topic)
      .option("startingOffsets", "latest")
      .load()

    val parsedStream = df.selectExpr("CAST(value AS STRING)")
      .select(from_json($"value", interactionSchema).as("data"))
      .select("data.*")

    // Use a plain Scala mutable Set to accumulate edges (avoids Spark DataFrame chaining issues)
    val edgeSet = mutable.HashSet[(Long, Long, String)]()
    var totalBatches = 0L
    val resultsPath = "/tmp/pagerank_results.json"

    println("Starting Streaming Query...")

    val query = parsedStream.writeStream
      .foreachBatch { (batchDF: org.apache.spark.sql.Dataset[Row], batchId: Long) =>
        val count = batchDF.count()
        if (count > 0) {
          println(s"\n--- Processing Batch $batchId with $count new interactions ---")
          totalBatches += 1

          // Collect batch rows into local Scala Set (deduplication is automatic via HashSet)
          batchDF.collect().foreach { row =>
            val src = row.getAs[Long]("source_user_id")
            val dst = row.getAs[Long]("target_user_id")
            val itype = row.getAs[String]("interaction_type")
            edgeSet.add((src, dst, itype))
          }

          val totalEdges = edgeSet.size
          println(s"Total accumulated unique edges: $totalEdges")

          if (totalEdges > 0) {
            // Build GraphX graph from accumulated edge set
            val edgesRDD: RDD[Edge[String]] = spark.sparkContext.parallelize(
              edgeSet.map { case (src, dst, itype) => Edge(src, dst, itype) }.toSeq
            )

            val graph = Graph.fromEdges(edgesRDD, "default_user")

            val ranks = graph.pageRank(0.0001).vertices
            val inDegrees = graph.inDegrees
            val activeVertices = graph.numVertices

            val stats = ranks.leftOuterJoin(inDegrees).map {
              case (id, (rank, inDegOpt)) => (id, rank, inDegOpt.getOrElse(0))
            }

            val statsDF = spark.createDataFrame(stats).toDF("user_id", "pagerank_score", "in_degree")

            println("Top 10 Influential Users (by PageRank):")
            statsDF.orderBy(desc("pagerank_score")).show(10)

            // Write results to JSON file for the API server
            val top10 = statsDF.orderBy(desc("pagerank_score")).limit(10).collect()
            val timestamp = System.currentTimeMillis()

            val influencersJson = top10.map { row =>
              val userId = row.getAs[Long]("user_id")
              val score  = row.getAs[Double]("pagerank_score")
              val inDeg  = row.getAs[Int]("in_degree")
              s"""    {"user_id":$userId,"pagerank_score":${"%.4f".format(score)},"in_degree":$inDeg}"""
            }.mkString(",\n")

            val json =
              s"""{
  "timestamp": $timestamp,
  "total_edges": $totalEdges,
  "active_vertices": $activeVertices,
  "total_batches": $totalBatches,
  "top_influencers": [
$influencersJson
  ]
}"""

            val pw = new PrintWriter(new File(resultsPath))
            try { pw.write(json) } finally { pw.close() }
            println(s"Results written to $resultsPath")
          }
        }
      }
      .start()

    query.awaitTermination()
  }
}
