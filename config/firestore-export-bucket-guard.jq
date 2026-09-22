(.location | ascii_upcase) == $location
and ((.uniform_bucket_level_access // .iamConfiguration.uniformBucketLevelAccess.enabled) == true)
and ((.public_access_prevention // .iamConfiguration.publicAccessPrevention) == "enforced")
and any(
  (.lifecycle_config.rule // .lifecycle.rule // [])[]?;
  .action.type == "Delete" and (.condition.age | tonumber) == 30
)
