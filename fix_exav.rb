require 'xcodeproj'

project_path = 'ios/Pods/Pods.xcodeproj'
project = Xcodeproj::Project.open(project_path)

target = project.targets.find { |t| t.name == 'EXAV' }
if target
  target.build_configurations.each do |config|
    settings = config.build_settings
    paths = settings['HEADER_SEARCH_PATHS'] ||= ['$(inherited)']
    paths << '"${PODS_ROOT}/React-Core-prebuilt/React.xcframework/Headers/React_Core"'
    paths << '"${PODS_ROOT}/React-Core-prebuilt/React.xcframework/Headers"'
    settings['HEADER_SEARCH_PATHS'] = paths.uniq
  end
  project.save
  puts "Updated EXAV HEADER_SEARCH_PATHS"
else
  puts "EXAV target not found"
end
